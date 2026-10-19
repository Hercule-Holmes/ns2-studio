import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { PadReport } from "@ns2-studio/pad-types";
import type {
  DeviceStatus,
  HubState,
  RemoteClientInfo,
  RemoteEndpointInfo,
  RemoteServerState,
  RemoteStatus,
} from "../../shared/ipc";
import type { InputHub } from "../hub/input-hub";
import type { DeviceService } from "../device/device-service";
import type { ConfigStore } from "../config/config-store";

const WS_PATH = "/ws";
const MAX_AUTH_FAILURES = 3;
/** SDP offers/answers run 2-8KB; 64KB leaves headroom without inviting abuse. */
const MAX_PAYLOAD_BYTES = 65536;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface RemoteGatewayDeps {
  hub: InputHub;
  device: DeviceService;
  config: ConfigStore;
  /** Directory with the built phone client (apps/desktop/out/remote-client). */
  staticDir: string;
  log?: (line: string) => void;
}

type ClientMessage =
  | { v?: number; type: "auth"; token?: unknown }
  | { v?: number; type: "source"; source?: unknown }
  | { v?: number; type: "pad"; report?: unknown }
  | { v?: number; type: "release" }
  | { v?: number; type: "ping"; t?: unknown; rttMs?: unknown }
  | { v?: number; type: "wake" }
  | { v?: number; type: "signal"; payload?: unknown };

interface Session {
  socket: WebSocket;
  peer: string;
  connectedAt: number;
  lastSeen: number;
  rttMs?: number;
}

function isValidReport(raw: unknown): raw is PadReport {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  return (
    int(r.buttons, 0, 0xffff) &&
    int(r.hat, 0, 8) &&
    int(r.lx, 0, 255) &&
    int(r.ly, 0, 255) &&
    int(r.rx, 0, 255) &&
    int(r.ry, 0, 255)
  );
}

/** Tailscale assigns CGNAT addresses from 100.64.0.0/10 (S16). */
export function isTailscaleAddress(ip: string): boolean {
  const o = ip.split(".").map(Number);
  return (
    o.length === 4 &&
    o[0] === 100 &&
    o[1]! >= 64 &&
    o[1]! <= 127 &&
    o.every((n) => n >= 0 && n <= 255)
  );
}

/**
 * Phone remote bridge (S13, 08-REMOTE.md). Owns the embedded HTTP server
 * (static phone client + `/ws`) and funnels authenticated `pad` messages into
 * the InputHub `remote` source. Exactly one session at a time; any teardown
 * path (client close, watchdog, server stop) neutralizes and returns the hub
 * to `idle` so no stuck key survives.
 */
export class RemoteGateway {
  private http?: Server;
  private wss?: WebSocketServer;
  private state: RemoteServerState = "stopped";
  private error?: string;
  /** Connected but not-yet-authenticated sockets. */
  private pending = new Map<WebSocket, { peer: string; failures: number }>();
  private session: Session | null = null;
  private watchdog?: NodeJS.Timeout;
  private offHub: () => void = () => {};
  private offDevice: () => void = () => {};
  private statusListeners = new Set<(status: RemoteStatus) => void>();
  /** Renderer → phone signaling (S15). */
  private signalListeners = new Set<(msg: { payload: unknown }) => void>();

  constructor(private deps: RemoteGatewayDeps) {}

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  async start(): Promise<RemoteStatus> {
    if (this.state === "running") return this.getStatus();
    await this.stop(true);
    this.state = "starting";
    this.emitStatus();
    const { port } = this.deps.config.get().remote;
    const app = createServer((req, res) => this.handleHttp(req, res));
    this.http = app;
    this.wss = new WebSocketServer({ server: app, path: WS_PATH, maxPayload: MAX_PAYLOAD_BYTES });
    this.wss.on("connection", (socket, req) => this.handleConnection(socket, req));

    let listenError: string | undefined;
    await new Promise<void>((resolve) => {
      app.once("error", (err: Error) => {
        listenError = err.message;
        resolve();
      });
      app.listen(port, "0.0.0.0", () => resolve());
    });

    if (listenError) {
      this.state = "error";
      this.error = listenError;
    } else {
      this.state = "running";
      this.error = undefined;
      this.offHub = this.deps.hub.on("stateChanged", () => this.broadcastState());
      this.offDevice = this.deps.device.on("stateChanged", () => this.broadcastState());
      this.deps.log?.(`[remote] listening on 0.0.0.0:${port}`);
    }
    this.emitStatus();
    return this.getStatus();
  }

  async stop(silent = false): Promise<void> {
    this.offHub();
    this.offDevice();
    this.offHub = () => {};
    this.offDevice = () => {};
    await this.endSession("server", silent);
    for (const socket of this.pending.keys()) socket.close();
    this.pending.clear();
    const wss = this.wss;
    const http = this.http;
    this.wss = undefined;
    this.http = undefined;
    await Promise.all([
      new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve())),
      new Promise<void>((resolve) =>
        http ? http.close(() => resolve()) : resolve(),
      ),
    ]);
    if (this.state !== "error") {
      this.state = "stopped";
      this.error = undefined;
    }
    if (!silent) this.emitStatus();
  }

  async dispose(): Promise<void> {
    await this.stop(true);
    this.statusListeners.clear();
    this.signalListeners.clear();
  }

  async setEnabled(enabled: boolean): Promise<RemoteStatus> {
    if (enabled) await this.start();
    else await this.stop();
    return this.getStatus();
  }

  async rotateToken(): Promise<RemoteStatus> {
    const token = randomBytes(16).toString("hex");
    this.deps.config.update({ remote: { token } });
    // A rotated token revokes the live session immediately.
    await this.endSession("server");
    this.emitStatus();
    return this.getStatus();
  }

  getStatus(): RemoteStatus {
    const { remote } = this.deps.config.get();
    const client: RemoteClientInfo | null = this.session
      ? {
          peer: this.session.peer,
          connectedAt: this.session.connectedAt,
          rttMs: this.session.rttMs,
        }
      : null;
    return {
      serverState: this.state,
      enabled: this.state === "running" || this.state === "starting",
      port: this.boundPort ?? remote.port,
      token: remote.token,
      client,
      error: this.error,
      urls: this.reachableEndpoints(this.boundPort ?? remote.port, remote.token),
    };
  }

  /** Actual bound port (differs from config when 0/ephemeral); null if stopped. */
  get boundPort(): number | null {
    const addr = this.http?.address();
    return typeof addr === "object" && addr !== null ? addr.port : null;
  }

  onStatus(cb: (status: RemoteStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Renderer → phone (S15). Drops silently when no live session. */
  sendSignalToClient(payload: unknown): void {
    const kind =
      typeof payload === "object" && payload !== null && "kind" in payload
        ? String((payload as { kind: unknown }).kind)
        : "unknown";
    this.deps.log?.(`[remote] signal R→C ${kind}`);
    this.session?.socket.send(JSON.stringify({ v: 1, type: "signal", payload }));
  }

  onSignal(cb: (msg: { payload: unknown }) => void): () => void {
    this.signalListeners.add(cb);
    return () => this.signalListeners.delete(cb);
  }

  // ------------------------------------------------------------------
  // HTTP (static phone client + tiny unauthenticated info endpoint)
  // ------------------------------------------------------------------

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/config") {
      const { remote } = this.deps.config.get();
      this.json(res, 200, { v: 1, heartbeatMs: remote.heartbeatMs, watchdogMs: remote.watchdogMs });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      this.json(res, 405, { error: "method not allowed" });
      return;
    }
    this.serveStatic(url.pathname, res);
  }

  private serveStatic(pathname: string, res: ServerResponse): void {
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = normalize(join(this.deps.staticDir, rel));
    // Path traversal guard: resolved file must stay inside staticDir.
    if (!file.startsWith(this.deps.staticDir + sep) && file !== this.deps.staticDir) {
      this.json(res, 403, { error: "forbidden" });
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      this.json(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  }

  private json(res: ServerResponse, code: number, body: unknown): void {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }

  private reachableEndpoints(port: number, token: string): RemoteEndpointInfo[] {
    const out: RemoteEndpointInfo[] = [];
    const seen = new Set<string>();
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.internal || ni.family !== "IPv4") continue;
        const key = ni.address;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          url: `http://${key}:${port}/?t=${token}`,
          address: key,
          kind: isTailscaleAddress(key) ? "tailscale" : "lan",
        });
      }
    }
    // LAN first (primary at home), tailnet last (away scenario).
    out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "lan" ? -1 : 1));
    return out;
  }

  // ------------------------------------------------------------------
  // WebSocket session handling
  // ------------------------------------------------------------------

  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const peer = `${req.socket.remoteAddress ?? "?"}:${req.socket.remotePort ?? "?"}`;
    socket.on("message", (data) => this.handleClientMessage(socket, peer, data.toString()));
    socket.on("close", () => this.handleSocketClosed(socket));
    socket.on("error", () => socket.terminate());
    this.pending.set(socket, { peer, failures: 0 });
    this.deps.log?.(`[remote] connection from ${peer}`);
  }

  private handleClientMessage(socket: WebSocket, peer: string, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(socket, "bad-message", "invalid json");
      return;
    }

    // Unauthenticated sockets may only auth.
    if (!this.pending.has(socket) && this.session?.socket !== socket) {
      this.sendError(socket, "not-authed", "authenticate first");
      socket.close();
      return;
    }

    if (msg.type === "auth") {
      this.handleAuth(socket, peer, msg.token);
      return;
    }

    if (this.session?.socket !== socket) {
      this.sendError(socket, "not-authed", "authenticate first");
      return;
    }
    this.session.lastSeen = Date.now();

    switch (msg.type) {
      case "source":
        void this.handleSource(socket, msg.source);
        break;
      case "pad":
        void this.handlePad(msg.report);
        break;
      case "release":
        void this.deps.hub.forceNeutral();
        break;
      case "ping": {
        // Client-reported RTT feeds the adaptive watchdog: a session on a
        // lossy path (DERP relay / 4G) legitimately stalls longer than the
        // base watchdog without being dead.
        if (
          typeof msg.rttMs === "number" &&
          Number.isFinite(msg.rttMs) &&
          msg.rttMs >= 0 &&
          msg.rttMs < 60_000 &&
          this.session
        ) {
          this.session.rttMs = msg.rttMs;
        }
        socket.send(JSON.stringify({ v: 1, type: "pong", t: msg.t ?? null }));
        break;
      }
      case "wake":
        // CMD_WAKE 0x92 via the serial device (02-PROTOCOL.md §3.4,
        // lab-notes/wake-research.md). A not-connected/unsupported device
        // still produces an explicit wakeResult instead of silence.
        void this.handleWake(socket);
        break;
      case "signal": {
        const kind =
          typeof msg.payload === "object" && msg.payload !== null && "kind" in msg.payload
            ? String((msg.payload as { kind: unknown }).kind)
            : "unknown";
        this.deps.log?.(`[remote] signal C→R ${kind}`);
        for (const cb of this.signalListeners) cb({ payload: msg.payload });
        break;
      }
      default:
        this.sendError(socket, "bad-message", `unknown type`);
    }
  }

  private handleAuth(socket: WebSocket, peer: string, token: unknown): void {
    const entry = this.pending.get(socket);
    if (!entry) return;
    const expected = this.deps.config.get().remote.token;
    if (typeof token !== "string" || token !== expected) {
      entry.failures += 1;
      if (entry.failures >= MAX_AUTH_FAILURES) {
        this.sendError(socket, "not-authed", "too many failures");
        socket.close();
        this.pending.delete(socket);
        return;
      }
      socket.send(JSON.stringify({ v: 1, type: "authError" }));
      return;
    }
    if (this.session) {
      this.sendError(socket, "busy", "another client holds the session");
      socket.close();
      this.pending.delete(socket);
      return;
    }
    this.pending.delete(socket);
    this.session = { socket, peer, connectedAt: Date.now(), lastSeen: Date.now() };
    socket.send(
      JSON.stringify({
        v: 1,
        type: "authOk",
        hub: this.deps.hub.getState(),
        device: this.deps.device.getStatus(),
      }),
    );
    this.armWatchdog();
    this.deps.log?.(`[remote] session opened: ${peer}`);
    this.emitStatus();
  }

  private async handleSource(socket: WebSocket, source: unknown): Promise<void> {
    if (source !== "remote") {
      this.sendError(socket, "bad-source", `phone may only take "remote"`);
      return;
    }
    await this.deps.hub.setSource("remote");
  }

  private async handlePad(raw: unknown): Promise<void> {
    if (!isValidReport(raw)) {
      this.sendError(this.session?.socket, "bad-message", "invalid report");
      return;
    }
    // Gated by InputHub: dropped unless `remote` is the active source.
    await this.deps.hub.applyFrom("remote", raw);
  }

  private async handleWake(socket: WebSocket): Promise<void> {
    const result = await this.deps.device.wake();
    try {
      socket.send(JSON.stringify({ v: 1, type: "wakeResult", ...result }));
    } catch {
      /* socket already gone */
    }
  }

  private handleSocketClosed(socket: WebSocket): void {
    this.pending.delete(socket);
    if (this.session?.socket === socket) void this.endSession("client");
  }

  /**
   * Any teardown path lands here: neutralize the device, return the hub to
   * `idle`, stop the watchdog and notify listeners. Safe to call repeatedly.
   */
  private async endSession(
    reason: "client" | "watchdog" | "server",
    silent = false,
  ): Promise<void> {
    const session = this.session;
    this.session = null;
    this.disarmWatchdog();
    if (!session) return;

    try {
      // setSource sends NEUTRAL before switching, so a single call clears
      // held keys and leaves the hub idle for the next source. Run this
      // before notifying/closing so teardown is complete when the client
      // observes the loss.
      await this.deps.hub.setSource("idle");
    } catch (err) {
      this.deps.log?.(
        `[remote] teardown setSource failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (reason !== "client") {
      try {
        session.socket.send(
          JSON.stringify({ v: 1, type: "sessionLost", reason }),
        );
      } catch {
        /* socket already gone */
      }
    }
    try {
      session.socket.close();
    } catch {
      /* already closed */
    }
    this.deps.log?.(`[remote] session closed (${reason})`);
    if (!silent) this.emitStatus();
  }

  // ------------------------------------------------------------------
  // Watchdog
  // ------------------------------------------------------------------

  private armWatchdog(): void {
    this.disarmWatchdog();
    const { watchdogMs } = this.deps.config.get().remote;
    this.watchdog = setInterval(() => {
      if (!this.session) return;
      // Adaptive: RTT-aware ceiling (6×RTT) so high-latency sessions
      // (DERP relay, 4G) survive transient stalls that exceed the base.
      const effective = Math.max(watchdogMs, (this.session.rttMs ?? 0) * 6);
      if (Date.now() - this.session.lastSeen <= effective) return;
      this.deps.log?.(
        `[remote] watchdog timeout — releasing session (rtt=${this.session.rttMs ?? "?"}ms)`,
      );
      void this.endSession("watchdog");
    }, Math.max(100, Math.floor(watchdogMs / 2)));
  }

  private disarmWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
  }

  // ------------------------------------------------------------------
  // Broadcasting
  // ------------------------------------------------------------------

  private broadcastState(): void {
    if (!this.session) return;
    const msg = JSON.stringify({
      v: 1,
      type: "state",
      hub: this.deps.hub.getState(),
      device: this.deps.device.getStatus(),
    });
    try {
      this.session.socket.send(msg);
    } catch {
      /* closed; close handler will clean up */
    }
  }

  private sendError(socket: WebSocket | undefined, code: string, message: string): void {
    socket?.send(JSON.stringify({ v: 1, type: "error", code, message }));
  }

  private emitStatus(): void {
    const status = this.getStatus();
    for (const cb of this.statusListeners) cb(status);
  }
}

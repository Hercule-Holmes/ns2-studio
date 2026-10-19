/**
 * WS transport for the remote bridge (08-REMOTE.md §4): connect → auth →
 * control messages, with heartbeat (ping/pong RTT), exponential-backoff
 * reconnect and typed callbacks for the UI layer.
 */
import type { PadReport } from "@ns2-studio/pad-types";

export type LinkPhase = "idle" | "connecting" | "ready" | "lost" | "error";

export interface HubDeviceState {
  hub: { activeSource: string };
  device: { state: string; version?: string };
}

const MAX_BACKOFF_MS = 8000;

export class RemoteLink {
  private ws: WebSocket | null = null;
  private token = "";
  private heartbeatMs = 250;
  private pingTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private retry = 0;
  private closedByUs = false;

  phase: LinkPhase = "idle";
  rttMs: number | null = null;

  onPhase: (phase: LinkPhase, detail?: string) => void = () => {};
  onState: (state: HubDeviceState) => void = () => {};
  onSessionLost: (reason: string) => void = () => {};
  onWakeResult: (result: { ok: boolean; code?: string; message?: string }) => void =
    () => {};
  onSignal: (payload: unknown) => void = () => {};

  constructor(private baseUrl: string) {}

  /** Read heartbeat/watchdog tuning from the gateway (no token required). */
  async probeConfig(): Promise<{ heartbeatMs: number; watchdogMs: number }> {
    const res = await fetch(`${this.baseUrl}/api/config`);
    if (!res.ok) throw new Error(`gateway /api/config ${res.status}`);
    const body = (await res.json()) as {
      heartbeatMs?: number;
      watchdogMs?: number;
    };
    return {
      heartbeatMs: body.heartbeatMs ?? 250,
      watchdogMs: body.watchdogMs ?? 1000,
    };
  }

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.retry = 0;
    this.open();
  }

  /** Tuned from GET /api/config; keep below the server watchdog. */
  setHeartbeatMs(ms: number): void {
    this.heartbeatMs = Math.max(50, Math.min(1000, ms));
  }

  private setPhase(phase: LinkPhase, detail?: string): void {
    this.phase = phase;
    this.onPhase(phase, detail);
  }

  private open(): void {
    this.teardownSocket();
    const wsUrl =
      this.baseUrl.replace(/^http/, "ws") + "/ws";
    this.setPhase("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : "open failed");
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ v: 1, type: "auth", token: this.token }));
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data as string);
    ws.onclose = () => {
      this.stopPing();
      if (this.closedByUs) {
        this.setPhase("idle");
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* close handler drives recovery */
    };
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case "authOk":
        this.retry = 0;
        this.setPhase("ready");
        this.startPing();
        this.onState({
          hub: msg.hub as HubDeviceState["hub"],
          device: msg.device as HubDeviceState["device"],
        });
        break;
      case "authError":
        this.closedByUs = true;
        this.ws?.close();
        this.setPhase("error", "令牌无效");
        break;
      case "error":
        this.setPhase("error", String(msg.message ?? msg.code ?? "未知错误"));
        break;
      case "state":
        this.onState({
          hub: msg.hub as HubDeviceState["hub"],
          device: msg.device as HubDeviceState["device"],
        });
        break;
      case "pong":
        if (typeof msg.t === "number") {
          this.rttMs = Date.now() - msg.t;
        }
        break;
      case "sessionLost":
        this.onSessionLost(String(msg.reason ?? "unknown"));
        break;
      case "wakeResult":
        this.onWakeResult({
          ok: msg.ok === true,
          code: typeof msg.code === "string" ? msg.code : undefined,
          message: typeof msg.message === "string" ? msg.message : undefined,
        });
        break;
      case "signal":
        this.onSignal(msg.payload);
        break;
      default:
        break;
    }
  }

  private scheduleReconnect(detail?: string): void {
    this.setPhase("lost", detail);
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retry);
    this.retry += 1;
    this.reconnectTimer = window.setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      // Measured RTT rides along so the server can widen its watchdog on
      // lossy paths (DERP relay / 4G) instead of killing healthy sessions.
      this.send({
        type: "ping",
        t: Date.now(),
        rttMs: this.rttMs ?? undefined,
      });
    }, this.heartbeatMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private teardownSocket(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror =
        null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  send(msg: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ v: 1, ...msg }));
  }

  /** Ask the gateway for the `remote` hub source. */
  takeOver(): void {
    this.send({ type: "source", source: "remote" });
  }

  /** Fire-and-forget neutralization (used before backgrounding). */
  release(): void {
    this.send({ type: "release" });
  }

  sendPad(report: PadReport): void {
    this.send({ type: "pad", report });
  }

  wake(): void {
    this.send({ type: "wake" });
  }

  sendSignal(payload: unknown): void {
    this.send({ type: "signal", payload });
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownSocket();
    this.setPhase("idle");
  }
}

/**
 * S21 v2: LAN HTTP forwarding proxy for Nintendo Switch downloads
 * (TypeScript port of ns2-download-accelerator proxy_accel.py, MIT).
 *
 * Mechanics (matches the community-verified working setup):
 *  - NS2 sets its proxy to this LAN listener (HTTP CONNECT + absolute HTTP).
 *  - Only Nintendo-owned hosts and ports 80/443 are allowed.
 *  - For each target host, candidates are collected from the configured
 *    public resolvers (UDP), TCP-connect ranked fastest-first, and the
 *    upstream connection is attempted in that order. The Switch does its own
 *    end-to-end TLS with the real CDN — the proxy only splices bytes, so the
 *    certificate problems that killed the DNS-hijack approach never appear.
 *  - Restricted to private-range clients; capped concurrency; idle timeout.
 */
import * as net from "node:net";
import { isIP } from "node:net";

export interface LanProxyConfig {
  port: number;
  /** Listen address; default 0.0.0.0. */
  host?: string;
  /** UDP DNS servers queried in parallel for candidates. */
  resolvers: string[];
  /** Allowed destination ports; default [80, 443]. */
  ports?: number[];
  /** Host suffix whitelist (lowercase, no leading dot). */
  roots: string[];
  /** Restrict client sources to private IPv4 ranges (default true). */
  lanOnly?: boolean;
  /** Allow private-range candidates (loopback tests; default false). */
  allowPrivateCandidates?: boolean;
  /** Max concurrent tunnels; default 32. */
  maxConns?: number;
  /** Splice idle timeout; default 300s. */
  idleTimeoutMs?: number;
  /** Injection points for tests. */
  resolveA?: (server: string, name: string, timeoutMs?: number) => Promise<string[]>;
  probeTcp?: (host: string, port: number, timeoutMs?: number) => Promise<number | null>;
  log?: (line: string) => void;
}

export interface LanProxyStats {
  connections: number;
  totalBytes: number;
}

interface PendingRequest {
  method: string;
  host: string;
  port: number;
  /** Rewritten bytes to send upstream (CONNECT sends none). */
  payload: Buffer;
}

const MAX_HEADER = 16 * 1024;
const DEFAULT_PORTS = [80, 443];
const MAX_CONNS = 32;
const IDLE_MS = 300_000;
const PROBE_TIMEOUT_MS = 2_000;

function isPrivateIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const o = ip.split(".").map(Number);
  if (o[0] === 10) return true;
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true;
  if (o[0] === 192 && o[1] === 168) return true;
  return o[0] === 127;
}

function inWhitelist(host: string, roots: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253) return false;
  if (!h.split(".").every((p) => /^[a-z0-9-]{1,63}$/i.test(p))) return false;
  return roots.some((root) => h === root || h.endsWith(`.${root}`));
}

function isHopByHop(name: string): boolean {
  return /connection|proxy-connection|proxy-authorization|keep-alive|upgrade|te|trailer/i.test(name);
}

interface ParsedRequest {
  method: string;
  host: string;
  port: number;
  /** Rewritten bytes to send upstream (CONNECT sends none). */
  payload: Buffer;
}

/** Read the first request (CONNECT or absolute-form HTTP) from the socket. */
function readRequest(sock: net.Socket): Promise<ParsedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.off("data", onData);
      sock.off("error", onError);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("header timeout"))), 10_000);
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      const all = Buffer.concat(chunks);
      const idx = all.indexOf("\r\n\r\n");
      if (idx < 0) {
        if (size > MAX_HEADER) finish(() => reject(new Error("header too large")));
        return;
      }
      try {
        finish(() => resolve(parseRequest(all)));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    };
    const onError = () => finish(() => reject(new Error("socket error while reading header")));
    sock.on("data", onData);
    sock.on("error", onError);
  });
}

function parseRequest(all: Buffer): ParsedRequest {
  const sep = all.indexOf("\r\n\r\n");
  const head = all.slice(0, sep).toString("latin1");
  const tail = all.slice(sep + 4);
  const lines = head.split("\r\n");
  const parts = lines[0]!.split(" ");
  if (parts.length !== 3) throw new Error("malformed request line");
  const [method, target, version] = parts as [string, string, string];
  if (version !== "HTTP/1.0" && version !== "HTTP/1.1") {
    throw new Error("invalid http version");
  }

  if (method === "CONNECT") {
    const colon = target.lastIndexOf(":");
    if (colon < 0) throw new Error("CONNECT requires host:port");
    const host = target.slice(0, colon);
    const port = Number(target.slice(colon + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("CONNECT bad port");
    }
    return { method: "CONNECT", host, port, payload: Buffer.alloc(0) };
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    throw new Error("unsupported method for plain http");
  }
  const match = target.match(/^http:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/);
  if (!match) throw new Error("absolute-form http url required");
  const authority = match[1]!;
  const hostName = authority.split(":")[0]!;
  const port = Number(authority.split(":")[1] ?? 80);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("bad port");
  }
  let path = match[2] || "/";
  if (match[3]) path += match[3];

  const headers: Array<[string, string]> = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push([line.slice(0, colon), line.slice(colon + 1).trim()]);
  }
  const first = `${method} ${path} ${version}\r\nHost: ${hostName}\r\nConnection: close\r\n`;
  const forwarded = headers
    .filter(([k]) => !isHopByHop(k))
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  const payload = Buffer.from(first + forwarded + "\r\n", "latin1");
  return { method, host: hostName, port, payload };
}

function replyEstablished(sock: net.Socket): void {
  sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
}

function replyError(sock: net.Socket, status: string): void {
  try {
    sock.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    sock.destroy();
  } catch {
    /* ignore */
  }
}

const defaultResolveA = (server: string, name: string, timeoutMs?: number): Promise<string[]> =>
  import("./resolver").then((m) => m.resolveA(server, name, { timeoutMs }));

const defaultProbeTcp = (host: string, port: number, timeoutMs = 2_000): Promise<number | null> =>
  new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const started = performance.now();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      sock.destroy();
      resolve(ok ? performance.now() - started : null);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });

/** Cached resolver + TCP-connect-ranked candidate ordering (per host:port). */
export class CandidateResolver {
  private cache = new Map<string, { expires: number; ips: string[] }>();

  constructor(
    private servers: string[],
    private resolveA: (server: string, name: string, timeoutMs?: number) => Promise<string[]>,
    private probeTcp: (host: string, port: number, timeoutMs?: number) => Promise<number | null>,
    private log?: (line: string) => void,
  ) {}

  /** Cached, TCP-connect-ranked candidate IPs; throws on total failure. */
  async connectOrdered(host: string, port: number, allowPrivate = false): Promise<string[]> {
    const key = `${host}:${port}`;
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.ips;

    const settled = await Promise.all(
      this.servers.map((s) => this.resolveA(s, host, 3000).catch(() => [] as string[])),
    );
    const seen = new Set<string>();
    for (const ips of settled) for (const ip of ips) seen.add(ip);
    let ips = [...seen].filter((ip) => isIP(ip) === 4 && (allowPrivate || !isPrivateIPv4(ip)));
    if (ips.length === 0) throw new Error("no public dns answers");

    const ranked = await Promise.all(
      ips.map(async (ip) => {
        const ms = await this.probeTcp(ip, port, PROBE_TIMEOUT_MS);
        return { ip, ms: ms === null ? Number.MAX_SAFE_INTEGER : ms };
      }),
    );
    ranked.sort((a, b) => a.ms - b.ms);
    ips = ranked.filter((r) => r.ms !== Number.MAX_SAFE_INTEGER).map((r) => r.ip);
    if (ips.length === 0) throw new Error("all candidates failed tcp probe");

    this.cache.set(key, { expires: Date.now() + 600_000, ips });
    this.log?.(
      `[netaccel] candidates ${key}: ${ranked
        .filter((r) => r.ms !== Number.MAX_SAFE_INTEGER)
        .slice(0, 6)
        .map((r) => `${r.ip}:${r.ms.toFixed(0)}ms`)
        .join(", ")}`,
    );
    return ips;
  }
}

export class LanProxy {
  private server: net.Server | null = null;
  private active = 0;
  private totalBytes = 0;
  private readonly ports: number[];
  private readonly roots: string[];
  private readonly lanOnly: boolean;
  private readonly maxConns: number;
  private readonly idleMs: number;
  private readonly log: (line: string) => void;
  private readonly resolver: CandidateResolver;
  private readonly allowPrivate: boolean;

  constructor(private config: LanProxyConfig) {
    this.allowPrivate = config.allowPrivateCandidates ?? false;
    this.resolver = new CandidateResolver(
      config.resolvers,
      config.resolveA ?? defaultResolveA,
      config.probeTcp ?? defaultProbeTcp,
      config.log,
    );
    this.ports = config.ports ?? DEFAULT_PORTS;
    this.roots = config.roots.map((r) => r.toLowerCase());
    this.lanOnly = config.lanOnly ?? true;
    this.maxConns = config.maxConns ?? MAX_CONNS;
    this.idleMs = config.idleTimeoutMs ?? IDLE_MS;
    this.log = config.log ?? (() => {});
  }

  getStats(): LanProxyStats {
    return { connections: this.active, totalBytes: this.totalBytes };
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return this.address()!;
    const host = this.config.host ?? "0.0.0.0";
    const port = this.config.port;
    return await new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handle(socket));
      server.on("error", (err) => reject(err));
      server.listen(port, host, () => {
        this.server = server;
        this.log(`[netaccel] proxy listening on ${host}:${port}`);
        resolve({ host, port });
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private address(): { host: string; port: number } | null {
    const addr = this.server?.address();
    if (!addr || typeof addr === "string") return null;
    return { host: addr.address, port: addr.port };
  }

  private handle(socket: net.Socket): void {
    const peer = (socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
    if (this.lanOnly && !isPrivateIPv4(peer)) {
      socket.destroy();
      return;
    }
    if (this.active >= this.maxConns) {
      replyError(socket, "503 Service Unavailable");
      return;
    }
    this.active += 1;
    socket.on("close", () => {
      this.active -= 1;
    });

    let request: ParsedRequest;
    try {
      readRequest(socket).then(
        (req) => this.route(socket, req),
        () => replyError(socket, "400 Bad Request"),
      );
    } catch {
      replyError(socket, "400 Bad Request");
    }
  }

  private route(socket: net.Socket, req: ParsedRequest): void {
    if (!inWhitelist(req.host, this.roots)) {
      this.log(`[netaccel] denied host=${req.host}`);
      replyError(socket, "403 Forbidden");
      return;
    }
    if (!this.ports.includes(req.port)) {
      replyError(socket, "403 Forbidden");
      return;
    }

    void this.resolver
      .connectOrdered(req.host, req.port, this.allowPrivate)
      .then((candidates) => {
        this.log(`[netaccel] candidates(${candidates.length}): ${candidates.join(",")}`);
        return this.dialFirst(candidates, req.port);
      })
      .then((upstream) => {
        this.log(
          `[netaccel] tunnel open ${req.method} ${req.host}:${req.port} via ${upstream.remoteAddress}`,
        );
        if (req.method === "CONNECT") replyEstablished(socket);
        else if (req.payload.length > 0) upstream.write(req.payload);
        this.spliceTunnels(socket, upstream);
      })
      .catch(() => replyError(socket, "502 Bad Gateway"));
  }

  private async dialFirst(candidates: string[], port: number): Promise<net.Socket> {
    for (const ip of candidates) {
      try {
        const sock = await this.dial(ip, port);
        this.log(`[netaccel] dialed ${ip}:${port} ok`);
        return sock;
      } catch (err) {
        this.log(
          `[netaccel] upstream ${ip}:${port} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    throw new Error("all candidates failed");
  }

  private dial(ip: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: ip, port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("connect timeout"));
      }, PROBE_TIMEOUT_MS);
      sock.once("connect", () => {
        clearTimeout(timer);
        resolve(sock);
      });
      sock.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private spliceTunnels(client: net.Socket, upstream: net.Socket): void {
    const closeBoth = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("close", () => closeBoth());
    client.on("error", () => closeBoth());
    upstream.on("close", () => closeBoth());
    upstream.on("error", () => closeBoth());
    client.on("data", (chunk: Buffer) => {
      if (upstream.writable) upstream.write(chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      this.totalBytes += chunk.length;
      if (client.writable) client.write(chunk);
    });
  }
}

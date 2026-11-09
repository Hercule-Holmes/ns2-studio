/**
 * S21: the netaccel DNS server. One UDP socket on (default) :53.
 *
 * - Accelerated domain with a verified best IP → synthesized A answer
 *   (short TTL so a refreshed table converges within a minute).
 * - Everything else → the query bytes are relayed verbatim to an upstream
 *   resolver through a per-query socket. The reply comes back on that socket,
 *   so no transaction-ID bookkeeping is needed and the answer is forwarded
 *   byte-identical (ID already matches the original query).
 */
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { DNS_TYPE_A, DNS_CLASS_IN, decodeMessage, encodeResponse, PacketError } from "./dns-packet";

export interface AccelDnsServerDeps {
  /** Verified best IP for an accelerated domain; null = forward upstream. */
  getBestIp: (domain: string) => string | null;
  isAccelerated: (name: string) => boolean;
  /** Upstream resolvers, tried round-robin. */
  upstream: string[];
  /** Upstream port (53 in production; injectable for tests). */
  upstreamPort?: number;
  answerTtlSec?: number;
  upstreamTimeoutMs?: number;
  log?: (line: string) => void;
}

interface ForwardContext {
  sock: Socket;
  timer: NodeJS.Timeout;
}

export class AccelDnsServer {
  private socket?: Socket;
  private forwards = new Set<ForwardContext>();
  private upstreamIdx = 0;
  private stopped = false;

  answered = 0;
  forwarded = 0;
  failed = 0;

  constructor(private deps: AccelDnsServerDeps) {}

  async start(port: number, host = "0.0.0.0"): Promise<void> {
    if (this.socket) throw new Error("dns server already started");
    this.stopped = false;
    const sock = createSocket("udp4");
    this.socket = sock;
    sock.on("message", (msg, rinfo) => {
      try {
        this.handle(msg, rinfo);
      } catch (err) {
        this.failed += 1;
        this.deps.log?.(
          `[netaccel] query handler error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    sock.on("error", (err) => {
      // EACCES/EADDRINUSE surface here on some platforms; callers await
      // start() and treat bind failure via the promise rejection below.
      this.deps.log?.(`[netaccel] socket error: ${err.message}`);
    });
    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => {
        sock.close();
        this.socket = undefined;
        reject(err);
      };
      sock.once("error", onErr);
      sock.bind(port, host, () => {
        sock.off("error", onErr);
        sock.on("error", () => {}); // later errors are non-fatal
        this.deps.log?.(`[netaccel] dns server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const f of this.forwards) {
      clearTimeout(f.timer);
      try {
        f.sock.close();
      } catch {
        /* already closed */
      }
    }
    this.forwards.clear();
    const sock = this.socket;
    this.socket = undefined;
    if (!sock) return;
    await new Promise<void>((resolve) => sock.close(() => resolve()));
  }

  get boundPort(): number | null {
    const addr = this.socket?.address();
    return typeof addr === "object" ? addr.port : null;
  }

  // ------------------------------------------------------------------

  private handle(msg: Buffer, rinfo: RemoteInfo): void {
    if (this.stopped) return;
    let decoded;
    try {
      decoded = decodeMessage(msg);
    } catch (err) {
      if (err instanceof PacketError) {
        this.failed += 1;
        return; // malformed: drop, client retries
      }
      throw err;
    }
    if (decoded.qr || decoded.questions.length !== 1) {
      // Not a query / multi-question: forward untouched and let upstream cope.
      this.forwardVerbatim(msg, rinfo);
      return;
    }
    const q = decoded.questions[0]!;
    const name = q.name.toLowerCase();

    if (
      this.deps.isAccelerated(name) &&
      q.type === DNS_TYPE_A &&
      q.klass === DNS_CLASS_IN
    ) {
      const best = this.deps.getBestIp(name);
      if (best) {
        const reply = encodeResponse(decoded, [
          { name: q.name, type: DNS_TYPE_A, ttl: this.deps.answerTtlSec ?? 60, ipv4: best },
        ]);
        this.socket?.send(reply, rinfo.port, rinfo.address);
        this.answered += 1;
        this.deps.log?.(`[netaccel] ${name} → ${best} (accelerated)`);
        return;
      }
      // Accelerated but no verified node yet: forwarding keeps the NS2 online
      // until the first speedtest finishes. Fail-open beats fail-closed here.
    }
    this.forwardVerbatim(msg, rinfo);
  }

  private forwardVerbatim(msg: Buffer, rinfo: RemoteInfo): void {
    if (this.stopped) return;
    const upstream = this.deps.upstream;
    if (upstream.length === 0) {
      this.failed += 1;
      return;
    }
    const server = upstream[this.upstreamIdx % upstream.length]!;
    this.upstreamIdx += 1;
    const timeoutMs = this.deps.upstreamTimeoutMs ?? 4000;

    const sock = createSocket("udp4");
    const ctx: ForwardContext = { sock, timer: null as unknown as NodeJS.Timeout };
    const cleanup = () => {
      clearTimeout(ctx.timer);
      this.forwards.delete(ctx);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
    };
    ctx.timer = setTimeout(() => {
      this.failed += 1;
      cleanup(); // silence → the NS2 retries on its own schedule
    }, timeoutMs);
    this.forwards.add(ctx);

    sock.on("error", cleanup);
    sock.on("message", (reply) => {
      if (this.stopped) return cleanup();
      this.socket?.send(reply, rinfo.port, rinfo.address);
      this.forwarded += 1;
      cleanup();
    });
    sock.send(msg, this.deps.upstreamPort ?? 53, server, (err) => {
      if (err) {
        this.failed += 1;
        cleanup();
      }
    });
  }
}

/**
 * S21: node ranking for the netaccel speedtest.
 *
 * Metrics, in order:
 *  1. TCP connect(443) median ms — Akamai edges are unreliable on ICMP, so
 *     handshake latency is the honest signal (and matches Switch traffic).
 *  2. TLS verify — an edge that doesn't serve *.nintendo.net will answer the
 *     handshake with a wrong certificate; `verifyTls` rejects those so we
 *     never point the NS2 at a node that fails cert validation.
 * Only the top-K fastest get TLS-verified; the first passing candidate
 * becomes `best`. If none verify, the table keeps best=null (no accel) —
 * safe-by-default beats slightly-faster.
 */
import { connect as tcpConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import type { AccelNodeRecord } from "../../shared/ipc";

export type ConnectProbe = (
  host: string,
  port: number,
  timeoutMs: number,
) => Promise<number | null>;

/** One TCP connect attempt; resolves elapsed ms, or null on failure/timeout. */
export const probeTcp: ConnectProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const started = performance.now();
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(ok ? performance.now() - started : null);
    };
    let sock: Socket;
    try {
      sock = tcpConnect({ host, port });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
  });

/** Median of `attempts` successful probes; null when all attempts fail. */
export async function probeTcpMedian(
  host: string,
  port: number,
  attempts: number,
  timeoutMs: number,
  probe: ConnectProbe = probeTcp,
): Promise<number | null> {
  const runs = await Promise.all(
    Array.from({ length: attempts }, () => probe(host, port, timeoutMs)),
  );
  const ok = runs.filter((r): r is number => r !== null).sort((a, b) => a - b);
  if (ok.length === 0) return null;
  const mid = Math.floor(ok.length / 2);
  return ok.length % 2 === 1 ? ok[mid]! : Math.round((ok[mid - 1]! + ok[mid]!) / 2);
}

/**
 * TLS handshake with `servername` as SNI and default certificate validation.
 * True only when the edge actually serves this hostname — exactly the
 * "验明正身" gate before promoting a node to `best`.
 */
export function verifyTls(host: string, servername: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(ok);
    };
    let sock: TLSSocket;
    try {
      sock = tlsConnect({ host, port: 443, servername, rejectUnauthorized: true });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once("secureConnect", () => finish(true));
    sock.once("error", () => finish(false));
  });
}

export interface RankOptions {
  attempts?: number;
  timeoutMs?: number;
  concurrency?: number;
  /** How many of the fastest candidates get TLS-verified, in order. */
  verifyTop?: number;
  verifyTimeoutMs?: number;
  probe?: ConnectProbe;
  verify?: typeof verifyTls;
  onProbed?: (record: AccelNodeRecord, done: number, total: number) => void;
}

/** Concurrency-limited probe + top-K TLS verify; sorted fastest-first. */
export async function rankNodes(
  candidates: string[],
  domain: string,
  opts: RankOptions = {},
): Promise<AccelNodeRecord[]> {
  const attempts = opts.attempts ?? 2;
  const timeoutMs = opts.timeoutMs ?? 1500;
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const verifyTop = opts.verifyTop ?? 3;
  const verifyTimeoutMs = opts.verifyTimeoutMs ?? 3000;
  const probe = opts.probe ?? probeTcp;
  const verify = opts.verify ?? verifyTls;

  const total = candidates.length;
  const records: AccelNodeRecord[] = candidates.map((ip) => ({
    ip,
    domain,
    rttMs: null,
    verified: false,
  }));

  // Simple worker pool: candidates are few (typically <30), pool beats
  // Promise.all fan-out for keeping latency probes from stepping on each other.
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      if (i >= total) return;
      next += 1;
      const rec = records[i]!;
      rec.rttMs = await probe(rec.ip, 443, timeoutMs).then((ms) =>
        ms === null ? null : Math.round(ms),
      );
      done += 1;
      opts.onProbed?.(rec, done, total);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );

  const byRtt = [...records].sort((a, b) => {
    if (a.rttMs === null && b.rttMs === null) return a.ip.localeCompare(b.ip);
    if (a.rttMs === null) return 1;
    if (b.rttMs === null) return -1;
    return a.rttMs - b.rttMs;
  });

  for (const rec of byRtt.slice(0, verifyTop)) {
    if (await verify(rec.ip, domain, verifyTimeoutMs)) {
      rec.verified = true;
      break;
    }
  }
  return byRtt;
}

/** Best IP per the record table: first verified, else null (no accel). */
export function pickBest(records: AccelNodeRecord[]): string | null {
  return records.find((r) => r.verified)?.ip ?? null;
}

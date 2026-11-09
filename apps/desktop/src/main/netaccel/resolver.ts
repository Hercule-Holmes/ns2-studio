/**
 * S21: UDP DNS client used by the speedtest scheduler to build the candidate
 * node pool. Asking several public resolvers the same question yields
 * different Akamai edge IPs — their union is the "一圈节点" we then probe.
 * No external deps: dns-packet.ts + dgram.
 */
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { decodeMessage, encodeQuery, type DnsMessage } from "./dns-packet";

export interface ResolveOptions {
  timeoutMs?: number;
  port?: number;
}

/**
 * Resolve all A records for `name` via plain UDP DNS. Never throws — a dead
 * resolver or timeout simply yields [] so multi-server fan-out can degrade.
 */
export function resolveA(
  server: string,
  name: string,
  opts: ResolveOptions = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const port = opts.port ?? 53;
  return new Promise((resolve) => {
    const sock: Socket = createSocket("udp4");
    const id = randomBytes(2).readUInt16BE(0);
    let settled = false;
    const finish = (ips: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(ips);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);

    sock.on("error", () => finish([]));
    sock.on("message", (msg: Buffer, _rinfo: RemoteInfo) => {
      let parsed: DnsMessage;
      try {
        parsed = decodeMessage(msg);
      } catch {
        return; // garbage mid-stream: keep waiting for a real reply
      }
      if (parsed.id !== id || !parsed.qr || parsed.rcode !== 0) return;
      const ips = parsed.answers
        .filter((a) => a.ipv4 !== undefined)
        .map((a) => a.ipv4!)
        .filter((ip, i, arr) => arr.indexOf(ip) === i);
      finish(ips);
    });

    const query = encodeQuery(id, name);
    sock.send(query, port, server, (err) => {
      if (err) finish([]);
    });
  });
}

/**
 * Query every (server × domain) pair in parallel and union the answers.
 * Returns a map of domain → sorted unique candidate IPs.
 */
export async function collectCandidates(
  servers: string[],
  domains: string[],
  opts: ResolveOptions = {},
): Promise<Map<string, string[]>> {
  const pairs: Array<{ domain: string; task: Promise<string[]> }> = [];
  for (const domain of domains) {
    for (const server of servers) {
      pairs.push({ domain, task: resolveA(server, domain, opts) });
    }
  }
  const settled = await Promise.all(pairs.map((p) => p.task));
  const out = new Map<string, string[]>();
  for (let i = 0; i < pairs.length; i += 1) {
    const domain = pairs[i]!.domain;
    const ips = settled[i] ?? [];
    const merged = new Set(out.get(domain) ?? []);
    for (const ip of ips) merged.add(ip);
    out.set(domain, [...merged].sort());
  }
  return out;
}

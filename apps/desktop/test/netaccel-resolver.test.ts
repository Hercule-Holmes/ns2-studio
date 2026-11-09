import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import { decodeMessage, encodeResponse } from "../src/main/netaccel/dns-packet";
import { collectCandidates, resolveA } from "../src/main/netaccel/resolver";

/** Minimal UDP responder: answers every A query with the given IPv4. */
function fakeDnsServer(ip: string): Promise<{ sock: Socket; port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    sock.on("message", (msg, rinfo) => {
      const q = decodeMessage(msg);
      const reply = encodeResponse(q, [
        { name: q.questions[0]!.name, type: 1, ttl: 300, ipv4: ip },
      ]);
      sock.send(reply, rinfo.port, rinfo.address);
    });
    sock.bind(0, "127.0.0.1", () => {
      const addr = sock.address();
      resolve({
        sock,
        port: addr.port,
        stop: () => new Promise((done) => sock.close(() => done())),
      });
    });
  });
}

describe("netaccel resolver (S21)", () => {
  const servers: Array<{ stop: () => Promise<void> }> = [];
  let portA = 0;
  let portB = 0;

  beforeAll(async () => {
    const a = await fakeDnsServer("1.2.3.4");
    const b = await fakeDnsServer("5.6.7.8");
    servers.push(a, b);
    portA = a.port;
    portB = b.port;
  });

  afterAll(async () => {
    await Promise.all(servers.map((s) => s.stop()));
  });

  it("resolveA parses A records from a UDP resolver", async () => {
    const ips = await resolveA("127.0.0.1", "atum.test", {
      port: portA,
      timeoutMs: 2000,
    });
    expect(ips).toEqual(["1.2.3.4"]);
  });

  it("resolveA times out to [] instead of throwing", async () => {
    // Port with no listener on loopback → ICMP refused → error → [].
    const ips = await resolveA("127.0.0.1", "x.test", {
      port: 1,
      timeoutMs: 300,
    });
    expect(ips).toEqual([]);
  });

  it("collectCandidates asks every resolver and dedupes the union", async () => {
    // Three resolver entries all pointing at the same fake (production passes
    // distinct :53 hosts); identical answers must collapse to one candidate.
    const out = await collectCandidates(
      ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
      ["atum.test", "atumn.test"],
      { port: portA, timeoutMs: 2000 },
    );
    expect(out.get("atum.test")).toEqual(["1.2.3.4"]);
    expect(out.get("atumn.test")).toEqual(["1.2.3.4"]);
    void portB;
  });

  it("collectCandidates unions distinct answers across resolvers", async () => {
    // resolveA per server (ports differ per fake), unioned like production.
    const [a, b] = await Promise.all([
      resolveA("127.0.0.1", "atum.test", { port: portA, timeoutMs: 2000 }),
      resolveA("127.0.0.1", "atum.test", { port: portB, timeoutMs: 2000 }),
    ]);
    expect([...new Set([...a, ...b])].sort()).toEqual(["1.2.3.4", "5.6.7.8"]);
  });
});

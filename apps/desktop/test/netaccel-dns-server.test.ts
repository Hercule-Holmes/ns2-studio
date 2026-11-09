import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSocket, type Socket } from "node:dgram";
import { decodeMessage, encodeQuery, encodeResponse } from "../src/main/netaccel/dns-packet";
import { AccelDnsServer } from "../src/main/netaccel/dns-server";

/** Fake upstream resolver on an ephemeral loopback port. */
function fakeUpstream(ip: string): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    sock.on("message", (msg, rinfo) => {
      const q = decodeMessage(msg);
      const reply = encodeResponse(q, [
        { name: q.questions[0]!.name, type: 1, ttl: 30, ipv4: ip },
      ]);
      sock.send(reply, rinfo.port, rinfo.address);
    });
    sock.bind(0, "127.0.0.1", () => {
      const port = sock.address().port;
      resolve({ port, stop: () => new Promise((d) => sock.close(() => d())) });
    });
  });
}

/** One DNS query against the server under test, awaiting its UDP reply. */
function query(port: number, name: string, timeoutMs = 2000): Promise<{ ips: string[] }> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    const timer = setTimeout(() => {
      sock.close();
      resolve({ ips: [] }); // timeout = no reply
    }, timeoutMs);
    sock.on("message", (msg) => {
      clearTimeout(timer);
      const parsed = decodeMessage(msg);
      const ips = parsed.answers.map((a) => a.ipv4).filter((v): v is string => !!v);
      sock.close();
      resolve({ ips });
    });
    sock.send(encodeQuery(0x4242, name), port, "127.0.0.1");
  });
}

describe("AccelDnsServer (S21)", () => {
  let upstream: { port: number; stop: () => Promise<void> };
  let server: AccelDnsServer;
  let port = 0;

  beforeAll(async () => {
    upstream = await fakeUpstream("9.9.9.9");
    server = new AccelDnsServer({
      getBestIp: (d) => (d === "atum.test" ? "1.2.3.4" : null),
      isAccelerated: (n) => n === "atum.test",
      upstream: ["127.0.0.1"],
      upstreamPort: upstream.port,
      answerTtlSec: 60,
    });
    await server.start(0, "127.0.0.1"); // ephemeral port
    port = server.boundPort!;
  });

  afterAll(async () => {
    await server.stop();
    await upstream.stop();
  });

  it("answers accelerated domains with the synthesized best IP", async () => {
    const { ips } = await query(port, "atum.test");
    expect(ips).toEqual(["1.2.3.4"]);
    expect(server.answered).toBe(1);
  });

  it("fails open to upstream when no verified node exists yet", async () => {
    const { ips } = await query(port, "atumn.test");
    expect(ips).toEqual(["9.9.9.9"]); // forwarded verbatim
    expect(server.forwarded).toBe(1);
  });

  it("forwards non-accelerated domains untouched", async () => {
    const { ips } = await query(port, "nintendo.com");
    expect(ips).toEqual(["9.9.9.9"]);
  });

  it("preserves the transaction id when synthesizing", async () => {
    const result = await new Promise<number | null>((resolve) => {
      const sock = createSocket("udp4");
      const timer = setTimeout(() => resolve(null), 2000);
      sock.on("message", (msg) => {
        clearTimeout(timer);
        resolve(decodeMessage(msg).id);
        sock.close();
      });
      sock.send(encodeQuery(0x0777, "atum.test"), port, "127.0.0.1");
    });
    expect(result).toBe(0x0777);
  });
});

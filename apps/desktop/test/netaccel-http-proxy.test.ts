/**
 * S21 v2: LAN download proxy tests 鈥?real sockets against a mock upstream.
 * The proxy is configured with an injected resolveA (always 127.0.0.1) and
 * an allowed port pointing at the mock, so tunnels land on our test server.
 */
import * as net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LanProxy, type LanProxyConfig } from "../src/main/netaccel/http-proxy";

const PROXY_PORT = 18899;
const UPSTREAM_PORT = 18080;
const HOST = "api.nintendo.net"; // matches the whitelist root nintendo.net

let upstreamServer: net.Server | null = null;
let upstreamHits = 0;
let upstreamLog: string[] = [];

function startUpstream(reply: string): Promise<void> {
  return new Promise((resolve) => {
    upstreamHits = 0;
    upstreamLog = [];
    upstreamServer = net.createServer((sock) => {
      sock.on("data", (chunk: Buffer) => {
        upstreamHits += 1;
        upstreamLog.push(chunk.toString("latin1"));
        sock.write(reply);
        sock.end();
      });
    });
    upstreamServer.listen(UPSTREAM_PORT, "127.0.0.1", () => resolve());
  });
}

function makeProxy(overrides?: Partial<LanProxyConfig>): LanProxy {
  const config: LanProxyConfig = {
    port: PROXY_PORT,
    host: "127.0.0.1",
    resolvers: ["10.11.12.13"],
    allowPrivateCandidates: true,
    ports: [UPSTREAM_PORT], // tests bind the mock on a high port
    roots: ["nintendo.net"],
    lanOnly: false, // the test client connects over 127.0.0.1
    resolveA: async () => ["127.0.0.1"],
    probeTcp: async () => 1,
    ...overrides,
  };
  return new LanProxy(config);
}

async function stopProxy(proxy: LanProxy): Promise<void> {
  await proxy.stop();
}

async function stopUpstream(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!upstreamServer) return resolve();
    upstreamServer.close(() => resolve());
    upstreamServer = null;
  });
}

/** Collect everything the proxy sends back until the socket closes. */
function collectFromProxy(write?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port: PROXY_PORT });
    const chunks: Buffer[] = [];
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("close", () => resolve(Buffer.concat(chunks)));
    sock.on("error", reject);
    if (write) sock.write(write);
  });
}

/** Two-phase client: CONNECT first, then a follow-up write into the tunnel. */
async function tunnelAndSpeak(
  connectLine: string,
  followUp: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port: PROXY_PORT });
    const chunks: Buffer[] = [];
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("close", () => resolve(Buffer.concat(chunks)));
    sock.on("error", reject);
    sock.write(connectLine);
    setTimeout(() => sock.write(followUp), 120);
    setTimeout(() => sock.end(), 1500);
  });
}

describe("netaccel LAN proxy (S21 v2)", () => {
  beforeEach(() => {
    upstreamHits = 0;
    upstreamLog = [];
  });

  afterEach(async () => {
    await stopUpstream();
  });

  it("forwards a plain GET to a whitelisted host", async () => {
    await startUpstream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHELLO");
    const proxy = makeProxy({ log: (l) => console.log("PROXY:", l) });
    await proxy.start();
    try {
      const res = await collectFromProxy(
        `GET http://${HOST}:${UPSTREAM_PORT}/path HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`,
      );
      expect(res.toString()).toContain("HELLO");
      expect(upstreamHits).toBe(1);
      expect(proxy.getStats().totalBytes).toBeGreaterThan(0);
    } finally {
      await stopProxy(proxy);
      await stopUpstream();
    }
  });

  it("rejects non-whitelisted hosts with 403", async () => {
    await startUpstream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHELLO");
    const proxy = makeProxy({ log: (l) => console.log("PROXY:", l) });
    await proxy.start();
    try {
      const res = await collectFromProxy(
        `GET http://evil.example.com:${UPSTREAM_PORT}/x HTTP/1.1\r\nHost: evil.example.com\r\n\r\n`,
      );
      expect(res.toString()).toContain("403");
      expect(upstreamHits).toBe(0);
    } finally {
      await stopProxy(proxy);
      await stopUpstream();
    }
  });

  it("tunnels CONNECT and relays a follow-up request into the tunnel", async () => {
    await startUpstream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHELLO");
    const proxy = makeProxy({ log: (l) => console.log("PROXY:", l) });
    await proxy.start();
    try {
      const res = await tunnelAndSpeak(
        `CONNECT ${HOST}:${UPSTREAM_PORT} HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`,
        `GET / HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`,
      );
      expect(res.toString()).toContain("200 Connection Established");
      expect(res.toString()).toContain("HELLO");
      expect(upstreamHits).toBe(1);
    } finally {
      await stopProxy(proxy);
      await stopUpstream();
    }
  });

  it("denies destination ports outside the allow list with 403", async () => {
    await startUpstream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHELLO");
    const proxy = makeProxy({ log: (l) => console.log("PROXY:", l) });
    await proxy.start();
    try {
      // default ports [80, 443] 鈥?CONNECT to a high port must be denied
      const res = await collectFromProxy(
        `CONNECT evil.nintendo.net:8080 HTTP/1.1\r\nHost: evil.nintendo.net\r\n\r\n`,
      );
      expect(res.toString()).toContain("403");
      expect(upstreamHits).toBe(0);
    } finally {
      await stopProxy(proxy);
      await stopUpstream();
    }
  });

  it("mismatches whitelist suffix only on real subdomain boundaries", async () => {
    await startUpstream("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHELLO");
    const proxy = makeProxy({ log: (l) => console.log("PROXY:", l) });
    await proxy.start();
    try {
      // "fakenintendo.net" ends with "nintendo.net" but NOT with ".nintendo.net"
      const res = await collectFromProxy(
        `GET http://fakenintendo.net:${UPSTREAM_PORT}/x HTTP/1.1\r\nHost: fakenintendo.net\r\n\r\n`,
      );
      expect(res.toString()).toContain("403");
    } finally {
      await stopProxy(proxy);
      await stopUpstream();
    }
  });
});

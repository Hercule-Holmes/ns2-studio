import { describe, expect, it, vi } from "vitest";
import type { ConnectProbe } from "../src/main/netaccel/speedtest";
import { pickBest, rankNodes } from "../src/main/netaccel/speedtest";

/** Deterministic fake probe: ip ends with latency encoded as "…:<ms>". */
function fakeProbe(delays: Record<string, number | null>): ConnectProbe {
  return (host) => {
    const ms = delays[host] ?? null;
    if (ms === null) return Promise.resolve(null);
    return new Promise((resolve) => setTimeout(() => resolve(ms as number), 1));
  };
}

const alwaysVerify = () => Promise.resolve(true);
const neverVerify = () => Promise.resolve(false);

describe("netaccel speedtest (S21)", () => {
  it("ranks nodes by median rtt and reports progress", async () => {
    const onProbed = vi.fn();
    const ranked = await rankNodes(
      Object.keys(delaysByIp()),
      "atum.test",
      {
        attempts: 1,
        timeoutMs: 1000,
        concurrency: 4,
        verifyTop: 0,
        probe: fakeProbe(delaysByIp()),
        verify: alwaysVerify,
        onProbed,
      },
    );
    const ips = ranked.map((r) => r.ip);
    expect(ips.indexOf("10.0.0.30")).toBeLessThan(ips.indexOf("10.0.0.80"));
    expect(ips.indexOf("10.0.0.80")).toBeLessThan(ips.indexOf("10.0.0.200"));
    expect(ips[ips.length - 1]).toBe("10.0.0.dead"); // null rtts sink to the bottom
    expect(onProbed).toHaveBeenCalledTimes(4);
    // Final progress tick must report completion.
    const last = onProbed.mock.calls.at(-1)!;
    expect(last[1]).toBe(4);
    expect(last[2]).toBe(4);
  });

  it("verifies only the fastest candidates and marks the first pass", async () => {
    const verify = vi.fn((ip: string) => Promise.resolve(ip === "10.0.0.80"));
    const ranked = await rankNodes(["10.0.0.200", "10.0.0.30", "10.0.0.80", "10.0.0.dead"], "atum.test", {
      attempts: 1,
      timeoutMs: 1000,
      concurrency: 4,
      verifyTop: 3,
      probe: fakeProbe(delaysByIp()),
      verify,
    });
    // 10.0.0.30 fails verify, 10.0.0.80 (2nd fastest) is promoted.
    expect(verify.mock.calls.map((c) => c[0])).toEqual(["10.0.0.30", "10.0.0.80"]);
    expect(ranked.find((r) => r.ip === "10.0.0.80")!.verified).toBe(true);
    expect(pickBest(ranked)).toBe("10.0.0.80");
  });

  it("keeps best=null when no candidate verifies (fail-safe)", async () => {
    const ranked = await rankNodes(["10.0.0.30", "10.0.0.80"], "atum.test", {
      attempts: 1,
      timeoutMs: 1000,
      concurrency: 2,
      verifyTop: 3,
      probe: fakeProbe(delaysByIp()),
      verify: neverVerify,
    });
    expect(ranked.every((r) => !r.verified)).toBe(true);
    expect(pickBest(ranked)).toBeNull();
  });

  it("sinks nodes whose probes all fail", async () => {
    const ranked = await rankNodes(["10.0.0.dead", "10.0.0.30"], "atum.test", {
      attempts: 2,
      timeoutMs: 500,
      concurrency: 2,
      verifyTop: 0,
      probe: fakeProbe(delaysByIp()),
      verify: alwaysVerify,
    });
    expect(ranked[ranked.length - 1]!.ip).toBe("10.0.0.dead");
    expect(ranked[ranked.length - 1]!.rttMs).toBeNull();
  });
});

function delaysByIp(): Record<string, number | null> {
  return {
    "10.0.0.30": 30,
    "10.0.0.80": 80,
    "10.0.0.200": 200,
    "10.0.0.dead": null,
  };
}

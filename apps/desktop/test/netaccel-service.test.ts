import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NetaccelService, type DnsServerLike } from "../src/main/netaccel/service";
import type { AccelNodeRecord } from "../src/shared/ipc";
import type { ConfigStore } from "../src/main/config/config-store";

function fakeConfig(netaccel: Record<string, unknown> = {}) {
  const state = {
    netaccel: {
      enabled: true,
      port: 45553,
      upstreamDns: ["10.255.255.1"],
      ...netaccel,
    },
  };
  return {
    get: () => structuredClone(state),
    update: vi.fn((patch: { netaccel?: Record<string, unknown> }) => {
      Object.assign(state.netaccel, patch.netaccel ?? {});
    }),
  } as unknown as ConfigStore;
}

function fakeServer(startError?: Error) {
  const calls = { started: 0, stopped: 0 };
  const server: DnsServerLike = {
    start: vi.fn(async () => {
      calls.started += 1;
      if (startError) throw startError;
    }),
    stop: vi.fn(async () => {
      calls.stopped += 1;
    }),
    answered: 0,
    forwarded: 0,
    failed: 0,
  };
  return { server, calls };
}

function makeService(opts: {
  netaccel?: Record<string, unknown>;
  emptyCollect?: boolean;
  startError?: Error;
} = {}) {
  const { server, calls } = fakeServer(opts.startError);
  const storeFile = join(mkdtempSync(join(tmpdir(), "ns2-netaccel-")), "nodes.json");
  // Pin the domain list to the fake data keys (default config would use the
  // real Nintendo CDN domains, which the injected fakes never answer for).
  const config = fakeConfig({ domains: ["atum.test"], ...opts.netaccel });
  const candidates = new Map(
    opts.emptyCollect
      ? [["atum.test", ["10.0.0.30"]]]
      : [["atum.test", ["10.0.0.30", "10.0.0.80"]]],
  );
  const ranked: AccelNodeRecord[] = opts.emptyCollect
    ? [{ ip: "10.0.0.30", domain: "atum.test", rttMs: null, verified: false }]
    : [
        { ip: "10.0.0.80", domain: "atum.test", rttMs: 80, verified: true },
        { ip: "10.0.0.30", domain: "atum.test", rttMs: null, verified: false },
      ];
  const svc = new NetaccelService({
    config,
    storeFile,
    collectCandidates: async () => candidates,
    rankNodes: async (_ips, _domain) => ranked,
    createServer: () => server,
    listLanIps: () => ["192.168.1.6"],
  });
  return { svc, config, storeFile, calls };
}

/** Wait until any in-flight speedtest run has fully settled. */
async function settled(svc: NetaccelService): Promise<void> {
  await vi.waitFor(() => {
    // lastRunAt is assigned after persist(), so non-null implies the table
    // (and nodes.json) are up to date; testState confirms no run in flight.
    if (svc.getStatus().lastRunAt === null) throw new Error("no run yet");
    if (svc.getStatus().testState !== "idle") throw new Error("still running");
  });
}

describe("NetaccelService (S21)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the dns server, auto-backfills an empty table and persists it", async () => {
    const { svc, storeFile, calls } = makeService();
    const status = await svc.start();
    expect(status.serverState).toBe("running");
    expect(calls.started).toBe(1);

    await settled(svc);
    const after = svc.getStatus();
    expect(after.testState).toBe("idle");
    expect(after.lastRunAt).not.toBeNull();
    expect(after.domains[0]!.best).toBe("10.0.0.80");
    expect(after.ns2DnsIps).toEqual(["192.168.1.6"]);

    const persisted = JSON.parse(readFileSync(storeFile, "utf8")) as {
      domains: Record<string, { best: string | null }>;
    };
    expect(persisted.domains["atum.test"]!.best).toBe("10.0.0.80");
    await svc.dispose();
  });

  it("does not auto-run when the table is fresh", async () => {
    const { svc } = makeService();
    await svc.start();
    await settled(svc); // first run (empty table backfill)
    const firstRunAt = svc.getStatus().lastRunAt;
    await svc.stop(true);
    await svc.start(); // table fresh → no second run
    expect(svc.getStatus().lastRunAt).toBe(firstRunAt);
    await svc.dispose();
  });

  it("runSpeedtest is idempotent while a run is active", async () => {
    const { svc } = makeService();
    await svc.start();
    await settled(svc);
    await Promise.all([svc.runSpeedtest(), svc.runSpeedtest()]);
    expect(svc.getStatus().testState).toBe("idle");
    expect(svc.getStatus().lastRunAt).not.toBeNull();
    await svc.dispose();
  });

  it("setEnabled drives the config and server lifecycle", async () => {
    const { svc, config, calls } = makeService();
    await svc.setEnabled(true);
    expect(calls.started).toBe(1);
    expect(config.update).toHaveBeenCalledWith({ netaccel: { enabled: true } });

    await svc.setEnabled(false);
    expect(calls.stopped).toBeGreaterThanOrEqual(1);
    expect(config.update).toHaveBeenCalledWith({ netaccel: { enabled: false } });
    expect(svc.getStatus().serverState).toBe("stopped");
    await svc.dispose();
  });

  it("reports an error state when the dns port is unavailable", async () => {
    const { svc } = makeService({ startError: new Error("EACCES: port taken") });
    const status = await svc.start();
    expect(status.serverState).toBe("error");
    expect(status.error).toContain("端口");
    await svc.dispose();
  });
});

import { describe, expect, it, vi } from "vitest";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import type { PadReport, TimedPadReport } from "@ns2-studio/pad-types";
import type { CompileResult, Project } from "@ns2-studio/timeline-model";
import { TimelineEngine } from "../src/main/timeline/engine";
import type {
  TimelineClock,
  TimelineDevice,
  TimelineHub,
} from "../src/main/timeline/engine";

class FakeClock implements TimelineClock {
  now = 0n;
  private queue: Array<{ at: bigint; id: number; cb: () => void }> = [];
  private nextId = 1;

  nowNs(): bigint {
    return this.now;
  }

  schedule(cb: () => void, delayMs: number): () => void {
    const at = this.now + BigInt(Math.round(delayMs * 1_000_000));
    const id = this.nextId++;
    this.queue.push({ at, id, cb });
    this.queue.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      this.queue = this.queue.filter((t) => t.id !== id);
    };
  }

  step(ns: bigint): void {
    this.now += ns;
    this.runDue();
  }

  runDue(): void {
    while (this.queue.length > 0 && this.queue[0]!.at <= this.now) {
      const t = this.queue.shift()!;
      t.cb();
    }
  }
}

class FakeHub implements TimelineHub {
  applied: PadReport[] = [];
  sources: string[] = [];
  neutralCount = 0;

  async setSource(source: "idle" | "manual" | "forward" | "timeline") {
    this.sources.push(source);
  }

  async forceNeutral(): Promise<void> {
    this.neutralCount++;
  }

  async applyFrom(_source: string, report: PadReport): Promise<void> {
    this.applied.push({ ...report });
  }
}

class FakeDevice implements TimelineDevice {
  isConnected = true;
  private cb: ((s: { state: string }) => void) | null = null;

  onStateChanged(cb: (s: { state: string }) => void): () => void {
    this.cb = cb;
    return () => {
      this.cb = null;
    };
  }

  emitStatus(state: string): void {
    this.cb?.({ state });
  }
}

interface Harness {
  engine: TimelineEngine;
  clock: FakeClock;
  hub: FakeHub;
  device: FakeDevice;
}

function makeHarness(opts?: {
  changeAmiiboIndex?: (slot: number) => Promise<unknown>;
  log?: (text: string) => void;
  defaultHz?: number;
}): Harness {
  const clock = new FakeClock();
  const hub = new FakeHub();
  const device = new FakeDevice();
  const engine = new TimelineEngine({
    hub,
    device,
    clock,
    changeAmiiboIndex: opts?.changeAmiiboIndex,
    log: opts?.log,
    defaultHz: opts?.defaultHz,
  });
  return { engine, clock, hub, device };
}

function projectA(): Project {
  return {
    magic: "NSPROJ",
    version: 1,
    name: "a-press",
    durationMs: 8,
    gridMs: 1,
    tracks: [
      {
        id: "btn",
        type: "buttons",
        clips: [{ id: "c1", key: "A", startMs: 0, endMs: 4 }],
      },
    ],
  };
}

/** 1kHz sampled frames from `projectA`: A on [0,4ms), neutral after. */
function framesOf(p: Project, hz: number): TimedPadReport[] {
  const stepMs = 1000 / hz;
  const count = Math.floor(p.durationMs / stepMs) + 1;
  const frames: TimedPadReport[] = [];
  for (let i = 0; i < count; i++) {
    const tMs = i * stepMs;
    const buttons = tMs >= 0 && tMs < 4 ? SwitchButton.A : 0;
    frames.push({ tUs: Math.round(tMs * 1000), ...NEUTRAL_REPORT, buttons });
  }
  return frames;
}

const flushAsync = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("TimelineEngine", () => {
  it("rejects play before any project is loaded", async () => {
    const { engine } = makeHarness();
    const res = await engine.play();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("未加载");
  });

  it("load compiles a Project and reports duration + frame count", () => {
    const { engine } = makeHarness();
    const res = engine.load(projectA(), { hz: 1000 });
    expect(res.ok).toBe(true);
    expect(res.durationMs).toBe(8);
    expect(res.frameCount).toBe(9);
  });

  it("load accepts a precompiled CompileResult", () => {
    const { engine } = makeHarness();
    const input: CompileResult = { frames: framesOf(projectA(), 1000), amiiboEvents: [] };
    const res = engine.load(input);
    expect(res.ok).toBe(true);
    expect(res.durationMs).toBe(8);
  });

  it("play while device disconnected errors and suggests dry-run", async () => {
    const { engine, device } = makeHarness();
    device.isConnected = false;
    engine.load(projectA(), { hz: 1000 });
    const res = await engine.play();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("未连接");
    expect(engine.getState().playing).toBe(false);
  });

  it("dry-run play works without a device and only moves the head", async () => {
    const { engine, device, hub } = makeHarness();
    device.isConnected = false;
    engine.load(projectA(), { hz: 1000 });
    const res = await engine.play({ dryRun: true });
    expect(res.ok).toBe(true);
    expect(engine.getState().playing).toBe(true);
    expect(hub.sources.length).toBe(0); // never claims the output source
    expect(hub.applied.length).toBe(0);
  });

  it("play claims source=timeline and applies the frame sequence", async () => {
    const { engine, hub, clock } = makeHarness();
    engine.load(projectA(), { hz: 1000 });
    await engine.play();

    // first frame (t=0) is applied immediately on claim
    expect(hub.applied.at(0)?.buttons).toBe(SwitchButton.A);

    for (let ms = 1; ms <= 8; ms++) {
      clock.step(1_000_000n);
    }
    await flushAsync();

    const aFrames = hub.applied.filter((r) => (r.buttons & SwitchButton.A) !== 0);
    expect(aFrames.length).toBeGreaterThanOrEqual(4);
    expect(hub.applied.at(-1)?.buttons).toBe(0); // neutral after clip ends
    expect(hub.sources).toContain("timeline");
  });

  it("finishes at end with reason=end, neutral and source idle", async () => {
    const { engine, hub, clock } = makeHarness();
    const states: Array<{ playing: boolean; reason?: string }> = [];
    engine.on("state", (s) => states.push(s));
    engine.load(projectA(), { hz: 1000 });
    await engine.play();
    for (let ms = 1; ms <= 8; ms++) clock.step(1_000_000n);
    await flushAsync();

    expect(engine.getState().playing).toBe(false);
    expect(states.at(-1)?.reason).toBe("end");
    expect(hub.neutralCount).toBeGreaterThanOrEqual(1);
    expect(hub.sources.at(-1)).toBe("idle");
  });

  it("pause keeps the position, neutralizes and releases the source", async () => {
    const { engine, hub, clock } = makeHarness();
    engine.load(projectA(), { hz: 1000 });
    await engine.play();
    clock.step(3_000_000n);
    const state = await engine.pause();

    expect(state.playing).toBe(false);
    expect(state.positionMs).toBeGreaterThan(0);
    expect(hub.neutralCount).toBeGreaterThanOrEqual(1);
    expect(hub.sources.at(-1)).toBe("idle");
  });

  it("stop is idempotent and returns the head to 0", async () => {
    const { engine, clock } = makeHarness();
    engine.load(projectA(), { hz: 1000 });
    await engine.play();
    clock.step(5_000_000n);

    const s1 = await engine.stop();
    const s2 = await engine.stop();

    expect(s1.positionMs).toBe(0);
    expect(s1.playing).toBe(false);
    expect(s2.positionMs).toBe(0);
    expect(s2.playing).toBe(false);
  });

  it("seek to the middle then play starts from the middle state", async () => {
    const { engine, hub, clock } = makeHarness();
    engine.load(projectA(), { hz: 1000 });
    engine.seek(5);

    await engine.play();
    // frame at 5ms (A released) is applied on claim, not frame 0 (A held)
    expect(hub.applied.at(0)?.buttons).toBe(0);

    for (let ms = 6; ms <= 8; ms++) clock.step(1_000_000n);
    await flushAsync();
    expect(engine.getState().playing).toBe(false);
  });

  it("device disconnect during play stops with reason=device-lost", async () => {
    const { engine, device, hub, clock } = makeHarness();
    const states: Array<{ playing: boolean; reason?: string }> = [];
    engine.on("state", (s) => states.push(s));
    engine.load(projectA(), { hz: 1000 });
    await engine.play();
    clock.step(2_000_000n);

    device.emitStatus("disconnected");
    await flushAsync();

    expect(engine.getState().playing).toBe(false);
    expect(states.at(-1)?.reason).toBe("device-lost");
    expect(hub.sources.at(-1)).toBe("idle");
  });

  it("fires amiibo events via the S9 hook at the right time", async () => {
    const changeAmiiboIndex = vi.fn(async (_slot: number) => {});
    const { engine, clock } = makeHarness({ changeAmiiboIndex });
    const p: Project = {
      ...projectA(),
      tracks: [
        {
          id: "am",
          type: "amiibo",
          clips: [{ id: "c4", startMs: 3, endMs: 4, slot: 7 }],
        },
      ],
    };
    engine.load(p, { hz: 1000 });
    await engine.play();
    clock.step(4_000_000n);
    await flushAsync();

    expect(changeAmiiboIndex).toHaveBeenCalledWith(7);
  });

  it("deduplicates amiibo events within the same millisecond (last wins)", async () => {
    const changeAmiiboIndex = vi.fn(async (_slot: number) => {});
    const { engine, clock } = makeHarness({ changeAmiiboIndex });
    const p: Project = {
      ...projectA(),
      tracks: [
        {
          id: "am",
          type: "amiibo",
          clips: [
            { id: "a1", startMs: 3, endMs: 4, slot: 1 },
            { id: "a2", startMs: 3, endMs: 4, slot: 7 },
          ],
        },
      ],
    };
    engine.load(p, { hz: 1000 });
    await engine.play();
    clock.step(4_000_000n);
    await flushAsync();

    expect(changeAmiiboIndex).toHaveBeenCalledTimes(1);
    expect(changeAmiiboIndex).toHaveBeenCalledWith(7);
  });

  it("drops out-of-range amiibo slots (0–15) with a warning log", async () => {
    const changeAmiiboIndex = vi.fn(async (_slot: number) => {});
    const logs: string[] = [];
    const { engine, clock } = makeHarness({ changeAmiiboIndex, log: (t) => logs.push(t) });
    const p: Project = {
      ...projectA(),
      tracks: [
        {
          id: "am",
          type: "amiibo",
          clips: [{ id: "a1", startMs: 3, endMs: 4, slot: 99 }],
        },
      ],
    };
    engine.load(p, { hz: 1000 });
    await engine.play();
    clock.step(4_000_000n);
    await flushAsync();

    expect(changeAmiiboIndex).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("超出 0–15"))).toBe(true);
  });

  it("amiibo events degrade to a no-op log when S9 is not wired", async () => {
    const logs: string[] = [];
    const { engine, clock } = makeHarness({ log: (t) => logs.push(t) });
    const p: Project = {
      ...projectA(),
      tracks: [
        {
          id: "am",
          type: "amiibo",
          clips: [{ id: "c4", startMs: 3, endMs: 4, slot: 7 }],
        },
      ],
    };
    engine.load(p, { hz: 1000 });
    await engine.play();
    clock.step(4_000_000n);
    await flushAsync();

    expect(logs.some((l) => l.includes("未接线"))).toBe(true);
  });

  it("load during playback stops playback first", async () => {
    const { engine, clock } = makeHarness();
    engine.load(projectA(), { hz: 1000 });
    await engine.play();
    clock.step(2_000_000n);

    const res = engine.load({ ...projectA(), name: "second" }, { hz: 1000 });
    await flushAsync();

    expect(res.ok).toBe(true);
    expect(engine.getState().playing).toBe(false);
    expect(engine.getState().positionMs).toBe(0);
  });
});
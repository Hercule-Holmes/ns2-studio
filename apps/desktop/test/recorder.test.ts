import { describe, expect, it } from "vitest";
import { NEUTRAL_REPORT, SwitchButton } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";
import {
  Recorder,
  type RecorderClock,
  type RecorderReportSource,
} from "../src/main/recorder/recorder";

class FakeClock implements RecorderClock {
  now = 0;
  nowUs(): number {
    return this.now;
  }
  advance(us: number): void {
    this.now += us;
  }
}

class FakeSource implements RecorderReportSource {
  listeners = new Set<(report: PadReport) => void>();
  neutralCalls = 0;

  onReport(cb: (report: PadReport) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  push(report: PadReport): void {
    for (const cb of [...this.listeners]) cb(report);
  }

  async forceNeutral(): Promise<void> {
    this.neutralCalls += 1;
    this.push(NEUTRAL_REPORT);
  }
}

function make(opts?: { compression?: boolean }) {
  const clock = new FakeClock();
  const source = new FakeSource();
  const recorder = new Recorder(source, {
    clock,
    tickHz: 250,
    deviceName: "NS2 Pro",
    compression: opts?.compression,
  });
  return { clock, source, recorder };
}

describe("Recorder", () => {
  it("starts idle and captures reports with tUs from start", async () => {
    const { clock, source, recorder } = make();
    expect(recorder.getState()).toBe("idle");

    recorder.start("manual");
    expect(recorder.getState()).toBe("recording");

    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    clock.advance(3000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.B });

    const rec = await recorder.stop();
    expect(recorder.getState()).toBe("idle");
    expect(rec).not.toBeNull();
    expect(rec!.magic).toBe("NSREC");
    expect(rec!.version).toBe(1);
    expect(rec!.meta.source).toBe("manual");
    expect(rec!.meta.tickHz).toBe(250);
    expect(rec!.meta.deviceName).toBe("NS2 Pro");
    expect(typeof rec!.meta.createdAt).toBe("string");
    expect(rec!.frames).toEqual([
      { tUs: 1000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: SwitchButton.B, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
  });

  it("keeps tUs non-decreasing", async () => {
    const { clock, source, recorder } = make();
    recorder.start("forward");
    clock.advance(2000);
    source.push({ ...NEUTRAL_REPORT, lx: 130 });
    clock.advance(500);
    source.push({ ...NEUTRAL_REPORT, lx: 140 });
    clock.advance(500);
    source.push({ ...NEUTRAL_REPORT, lx: 130 });

    const rec = await recorder.stop();
    const tUs = rec!.frames.map((f) => f.tUs);
    for (let i = 1; i < tUs.length; i++) {
      expect(tUs[i]!).toBeGreaterThanOrEqual(tUs[i - 1]!);
    }
  });

  it("skips consecutive identical reports when compression is on", async () => {
    const { clock, source, recorder } = make({ compression: true });
    recorder.start("manual");
    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    clock.advance(1000);
    source.push(NEUTRAL_REPORT);

    const rec = await recorder.stop();
    expect(rec!.frames).toHaveLength(2);
    expect(rec!.frames[0]).toMatchObject({ tUs: 1000, buttons: SwitchButton.A });
    expect(rec!.frames[1]).toMatchObject({ tUs: 3000, buttons: 0 });
  });

  it("keeps every report when compression is off", async () => {
    const { clock, source, recorder } = make({ compression: false });
    recorder.start("manual");
    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    clock.advance(1000);
    source.push(NEUTRAL_REPORT);

    const rec = await recorder.stop();
    expect(rec!.frames).toHaveLength(4);
  });

  it("stop neutralizes the device and captures the final neutral", async () => {
    const { clock, source, recorder } = make();
    recorder.start("manual");
    clock.advance(1000);
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });

    const rec = await recorder.stop();
    expect(source.neutralCalls).toBe(1);
    const last = rec!.frames[rec!.frames.length - 1]!;
    expect(last.buttons).toBe(0);
    expect(last.tUs).toBe(1000);
  });

  it("stop while the last report is neutral does not duplicate frames", async () => {
    const { clock, source, recorder } = make();
    recorder.start("manual");
    clock.advance(1000);
    source.push(NEUTRAL_REPORT);

    const rec = await recorder.stop();
    expect(source.neutralCalls).toBe(1);
    expect(rec!.frames).toHaveLength(1);
  });

  it("stop when not recording returns null", async () => {
    const { recorder } = make();
    expect(await recorder.stop()).toBeNull();
  });

  it("reset drops frames and unsubscribes from the source", () => {
    const { source, recorder } = make();
    recorder.start("manual");
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    expect(recorder.frameCount).toBe(1);

    recorder.reset();
    expect(recorder.getState()).toBe("idle");
    expect(recorder.frameCount).toBe(0);

    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.B });
    expect(recorder.frameCount).toBe(0);
  });

  it("emits stateChanged on start and stop", async () => {
    const { source, recorder } = make();
    const states: string[] = [];
    const off = recorder.onStateChanged((s) => states.push(s));
    recorder.start("manual");
    source.push(NEUTRAL_REPORT);
    await recorder.stop();
    expect(states).toEqual(["recording", "idle"]);
    off();
  });

  it("start is a no-op while already recording", async () => {
    const { source, recorder } = make();
    recorder.start("manual");
    recorder.start("manual");
    source.push({ ...NEUTRAL_REPORT, buttons: SwitchButton.A });
    const rec = await recorder.stop();
    // A + the stop-time neutral
    expect(rec!.frames).toHaveLength(2);
  });
});
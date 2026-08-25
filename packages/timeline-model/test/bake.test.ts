import { describe, expect, it } from "vitest";
import { SwitchButton } from "@ns2-studio/pad-types";
import { bake, type Recording } from "../src/index";

function recording(frames: Recording["frames"]): Recording {
  return {
    magic: "NSREC",
    version: 1,
    meta: {
      createdAt: "2026-08-22T00:00:00.000Z",
      source: "forward",
      deviceName: "NS2 Pro",
      tickHz: 250,
    },
    frames,
  };
}

describe("bake: 按键边沿 → button clips", () => {
  it("detects press/release edges into clips", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 8000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 12000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bake(rec);
    expect(project.durationMs).toBe(12);
    const btnTrack = project.tracks.find((t) => t.type === "buttons");
    expect(btnTrack).toBeDefined();
    expect(btnTrack!.type).toBe("buttons");
    const clips = (btnTrack as { clips: { key: string; startMs: number; endMs: number }[] }).clips;
    expect(clips).toEqual([{ id: "btn_A_0", key: "A", startMs: 4, endMs: 12 }]);
  });

  it("keeps a button still held at the end open until durationMs", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: SwitchButton.B, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bake(rec);
    const btnTrack = project.tracks.find((t) => t.type === "buttons") as {
      clips: { key: string; startMs: number; endMs: number }[];
    };
    expect(btnTrack.clips).toEqual([{ id: "btn_B_0", key: "B", startMs: 4, endMs: 4 }]);
  });
});

describe("bake: 摇杆降采样 + 死区", () => {
  it("produces keyframes from center to top with a dead zone", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: 0, hat: 8, lx: 128, ly: 120, rx: 128, ry: 128 },
      { tUs: 8000, buttons: 0, hat: 8, lx: 128, ly: 100, rx: 128, ry: 128 },
      { tUs: 12000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bake(rec, { deadZone: 5, stickDecimation: 1 });
    const stickTrack = project.tracks.find(
      (t) => t.type === "stick" && t.stick === "L",
    ) as { clips: { keyframes: { offsetMs: number; x: number; y: number }[] }[] };
    expect(stickTrack).toBeDefined();
    expect(stickTrack.clips[0]!.keyframes[1]).toEqual({ offsetMs: 4, x: 128, y: 120 });
    expect(stickTrack.clips[0]!.keyframes[2]).toEqual({ offsetMs: 8, x: 128, y: 100 });
  });

  it("with a wide dead zone keeps only the neutral keyframe", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: 0, hat: 8, lx: 128, ly: 120, rx: 128, ry: 128 },
    ]);
    const project = bake(rec, { deadZone: 20, stickDecimation: 1 });
    const stickTrack = project.tracks.find((t) => t.type === "stick" && t.stick === "L");
    expect(stickTrack).toBeUndefined();
  });
});

describe("bake: 录制校验", () => {
  it("rejects an out-of-order frame stream", () => {
    const rec = recording([
      { tUs: 8000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    expect(() => bake(rec)).toThrowError("non-decreasing tUs");
  });
});
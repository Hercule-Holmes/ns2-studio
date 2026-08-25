import { describe, expect, it } from "vitest";
import { SwitchButton } from "@ns2-studio/pad-types";
import { bakeRecording } from "../src/renderer/recorder/bake";
import type { Recording } from "@ns2-studio/timeline-model";

function recording(frames: Recording["frames"]): Recording {
  return {
    magic: "NSREC",
    version: 1,
    meta: {
      createdAt: "2026-08-22T00:00:00.000Z",
      source: "manual",
      deviceName: "NS2 Pro",
      tickHz: 250,
    },
    frames,
  };
}

describe("bakeRecording (S7 bake entry)", () => {
  it("passes dead zone through to timeline-model bake", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 8000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bakeRecording(rec, { name: "t", deadZone: 4, minButtonMs: 0 });
    expect(project.magic).toBe("NSPROJ");
    expect(project.durationMs).toBe(8);
    expect(project.tracks.find((t) => t.type === "buttons")).toBeDefined();
  });

  it("filters button clips shorter than minButtonMs", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 1000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 2000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 3000, buttons: SwitchButton.B, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 8000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bakeRecording(rec, { name: "t", deadZone: 4, minButtonMs: 5 });
    const btnTrack = project.tracks.find((t) => t.type === "buttons") as {
      clips: { key: string; startMs: number; endMs: number }[];
    };
    // A: 1ms..2ms (1ms) dropped; B: 3ms..8ms (5ms) kept.
    expect(btnTrack.clips.map((c) => c.key)).toEqual(["B"]);
  });

  it("minButtonMs 0 keeps every clip", () => {
    const rec = recording([
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 1000, buttons: SwitchButton.A, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 2000, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ]);
    const project = bakeRecording(rec, { name: "t", deadZone: 4, minButtonMs: 0 });
    const btnTrack = project.tracks.find((t) => t.type === "buttons") as {
      clips: { key: string }[];
    };
    expect(btnTrack.clips.map((c) => c.key)).toEqual(["A"]);
  });
});
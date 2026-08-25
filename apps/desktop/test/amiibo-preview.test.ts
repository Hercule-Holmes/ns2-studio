import { describe, expect, it } from "vitest";
import type { Project } from "@ns2-studio/timeline-model";
import { nextAmiiboHint } from "../src/renderer/timeline/amiibo-preview";

function projectWithAmiibo(
  clips: { id: string; startMs: number; slot: number }[],
): Project {
  return {
    magic: "NSPROJ",
    version: 1,
    name: "preview",
    durationMs: 6000,
    gridMs: 10,
    tracks: [
      {
        id: "track_amiibo",
        type: "amiibo",
        clips: clips.map((c) => ({ ...c, endMs: c.startMs + 1 })),
      },
    ],
  };
}

describe("nextAmiiboHint (S10 preview)", () => {
  it("returns null when the project has no amiibo clips", () => {
    const p: Project = {
      magic: "NSPROJ",
      version: 1,
      name: "plain",
      durationMs: 1000,
      gridMs: 10,
      tracks: [
        { id: "t", type: "buttons", clips: [{ id: "c", key: "A", startMs: 0, endMs: 10 }] },
      ],
    };
    expect(nextAmiiboHint(p, 0)).toBeNull();
  });

  it("returns the earliest upcoming slot strictly after the position", () => {
    const p = projectWithAmiibo([
      { id: "a1", startMs: 2000, slot: 1 },
      { id: "a2", startMs: 4000, slot: 3 },
    ]);
    expect(nextAmiiboHint(p, 0)).toEqual({ slot: 1, atMs: 2000 });
    expect(nextAmiiboHint(p, 2500)).toEqual({ slot: 3, atMs: 4000 });
  });

  it("ignores already-passed clips and returns null past the last one", () => {
    const p = projectWithAmiibo([{ id: "a1", startMs: 1000, slot: 5 }]);
    expect(nextAmiiboHint(p, 999)).toEqual({ slot: 5, atMs: 1000 });
    expect(nextAmiiboHint(p, 1000)).toBeNull(); // at the trigger edge it is not "upcoming"
    expect(nextAmiiboHint(p, 5000)).toBeNull();
  });

  it("picks the earliest across multiple amiibo tracks", () => {
    const p: Project = {
      ...projectWithAmiibo([{ id: "a1", startMs: 3000, slot: 2 }]),
      tracks: [
        ...projectWithAmiibo([{ id: "a1", startMs: 3000, slot: 2 }]).tracks,
        {
          id: "track_amiibo2",
          type: "amiibo",
          clips: [{ id: "a2", startMs: 1500, endMs: 1501, slot: 4 }],
        },
      ],
    };
    expect(nextAmiiboHint(p, 0)).toEqual({ slot: 4, atMs: 1500 });
  });
});
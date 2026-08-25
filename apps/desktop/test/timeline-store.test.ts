import { describe, expect, it } from "vitest";
import { validateProject, migrate, type Project } from "@ns2-studio/timeline-model";
import { createTimelineStore } from "../src/renderer/timeline/store";
import type { TimelineStore } from "../src/renderer/timeline/store";

function fresh(): TimelineStore {
  return createTimelineStore();
}

function projectEqual(a: Project, b: Project): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe("timeline store — project lifecycle", () => {
  it("new project is seeded with default tracks and validates", () => {
    const store = fresh();
    expect(store.project.tracks.map((t) => t.type)).toEqual([
      "buttons",
      "stick",
      "stick",
      "hat",
      "marker",
    ]);
    expect(store.validate()).toBeNull();
  });

  it("serialize -> openFromContent round-trips identically", () => {
    const store = fresh();
    store.setPlayhead(400);
    store.addClip("buttons");
    store.setPlayhead(1200);
    store.addClip("hat");
    const json = store.serialize();
    const revived = fresh();
    revived.openFromContent(json, null);
    expect(projectEqual(store.project, revived.project)).toBe(true);
    expect(revived.validate()).toBeNull();
  });

  it("creates an 'A pressed 3 times' project and reopens consistently", () => {
    const store = fresh();
    for (const ms of [0, 400, 800]) {
      store.setPlayhead(ms);
      store.addClip("buttons");
    }
    const json = store.serialize();
    const revived = fresh();
    revived.openFromContent(json, null);
    expect(projectEqual(store.project, revived.project)).toBe(true);
    const buttons = revived.project.tracks.find((t) => t.type === "buttons")!;
    expect(buttons.clips).toHaveLength(3);
    expect(buttons.clips.every((c) => c.key === "A")).toBe(true);
  });
});

describe("timeline store — clip editing", () => {
  it("adds a buttons clip at the snapped playhead", () => {
    const store = fresh();
    store.setPlayhead(395);
    store.addClip("buttons");
    const clip = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    expect(clip.startMs).toBe(400);
    expect((clip as { key: string }).key).toBe("A");
    expect(store.validate()).toBeNull();
  });

  it("rejects end < start with an error hint", () => {
    const store = fresh();
    store.addClip("buttons");
    const clip = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    store.updateClipField("track_buttons", clip.id, "startMs", 100);
    const ok = store.updateClipField("track_buttons", clip.id, "endMs", 50);
    expect(ok).toBe(false);
    expect(store.validationError).toMatch(/end < start/);
    expect(clip.endMs).toBeGreaterThanOrEqual(clip.startMs);
  });

  it("rejects an unknown button key", () => {
    const store = fresh();
    store.addClip("buttons");
    const clip = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    const ok = store.updateClipField("track_buttons", clip.id, "key", "ZZZ");
    expect(ok).toBe(false);
    expect(store.validationError).toMatch(/未知按键/);
  });

  it("moveClip within a transaction is committed once and undoable", () => {
    const store = fresh();
    store.addClip("buttons");
    const track = store.project.tracks.find((t) => t.type === "buttons")!;
    const clip = track.clips[0]!;
    const before = clip.startMs;
    store.beginTransaction();
    store.moveClip(track.id, clip.id, before + 500, before + 700);
    store.commitTransaction();
    expect(clip.startMs).toBe(before + 500);
    expect(store.dirty).toBe(true);
    store.undo();
    const afterUndo = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    expect(afterUndo.startMs).toBe(before);
    store.redo();
    const afterRedo = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    expect(afterRedo.startMs).toBe(before + 500);
  });

  it("cancelTransaction restores the previous state", () => {
    const store = fresh();
    store.addClip("buttons");
    const clip = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    const before = clip.startMs;
    const depthBefore = store.undoDepth;
    store.beginTransaction();
    store.moveClip("track_buttons", clip.id, before + 300, before + 500);
    store.cancelTransaction();
    const after = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!;
    expect(after.startMs).toBe(before);
    expect(store.undoDepth).toBe(depthBefore);
  });
});

describe("timeline store — multi-select, copy/paste, undo", () => {
  it("deletes multiple selected clips at once", () => {
    const store = fresh();
    store.setPlayhead(0);
    store.addClip("buttons");
    const a = store.project.tracks.find((t) => t.type === "buttons")!.clips[0]!.id;
    store.setPlayhead(1000);
    store.addClip("buttons");
    const b = store.project.tracks.find((t) => t.type === "buttons")!.clips[1]!.id;
    store.selectOnly(a);
    store.toggleSelect(b);
    store.removeSelected();
    expect(store.project.tracks.find((t) => t.type === "buttons")!.clips).toHaveLength(0);
    store.undo();
    expect(store.project.tracks.find((t) => t.type === "buttons")!.clips).toHaveLength(2);
  });

  it("copy + paste duplicates a clip at the playhead", () => {
    const store = fresh();
    store.setPlayhead(100);
    store.addClip("buttons");
    const track = store.project.tracks.find((t) => t.type === "buttons")!;
    const src = track.clips[0]!;
    store.selectOnly(src.id);
    store.copySelected();
    store.setPlayhead(2000);
    store.paste();
    const clips = store.project.tracks.find((t) => t.type === "buttons")!.clips;
    expect(clips).toHaveLength(2);
    const pasted = clips[1]!;
    expect(pasted.id).not.toBe(src.id);
    expect(pasted.startMs).toBe(2000);
    expect((pasted as { key: string }).key).toBe("A");
    expect(store.selectedIds).toEqual([pasted.id]);
  });

  it("copies stick clips with their keyframes", () => {
    const store = fresh();
    store.setPlayhead(500);
    store.addClip("stickL");
    const track = store.project.tracks.find(
      (t) => t.type === "stick" && (t as { stick: string }).stick === "L",
    )!;
    const src = track.clips[0]!;
    store.selectOnly(src.id);
    store.copySelected();
    store.setPlayhead(3000);
    store.paste();
    const clips = store.project.tracks.find(
      (t) => t.type === "stick" && (t as { stick: string }).stick === "L",
    )!.clips;
    expect(clips).toHaveLength(2);
    expect((clips[1] as { keyframes: unknown[] }).keyframes).toHaveLength(2);
    expect(store.validate()).toBeNull();
  });
});

describe("timeline store — validation & model contract", () => {
  it("openFromContent surfaces invalid projects as readable errors", () => {
    const store = fresh();
    const bad = {
      magic: "NSPROJ",
      version: 1,
      name: "坏工程",
      durationMs: 1000,
      gridMs: 10,
      tracks: [
        {
          id: "t",
          type: "buttons",
          clips: [{ id: "c", key: "A", startMs: 500, endMs: 100 }],
        },
      ],
    };
    expect(() => store.openFromContent(JSON.stringify(bad), null)).toThrow(/endMs/);
  });

  it("keeps every edited project valid for validateProject", () => {
    const store = fresh();
    store.addClip("buttons");
    store.addClip("stickL");
    store.addClip("hat");
    store.addClip("marker");
    const track = store.project.tracks.find((t) => t.type === "buttons")!;
    const clip = track.clips[0]!;
    store.updateClipField(track.id, clip.id, "key", "X");
    store.updateClipField(track.id, clip.id, "startMs", 100);
    store.updateClipField(track.id, clip.id, "endMs", 250);
    expect(() => validateProject(store.project)).not.toThrow();
  });

  it("migrate() accepts the store's own serialized output", () => {
    const store = fresh();
    store.addClip("buttons");
    const migrated = migrate(JSON.parse(store.serialize()));
    expect(projectEqual(store.project, migrated)).toBe(true);
  });
});

describe("timeline store — amiibo track (S10)", () => {
  it("creates an amiibo track on demand and adds a slot-0 clip at the playhead", () => {
    const store = fresh();
    store.setPlayhead(1200);
    store.addClip("amiibo");
    const track = store.project.tracks.find((t) => t.type === "amiibo");
    expect(track).toBeDefined();
    const clip = track!.clips[0] as { startMs: number; slot: number };
    expect(clip.startMs).toBe(1200);
    expect(clip.slot).toBe(0);
    expect(store.validate()).toBeNull();
  });

  it("accepts slot edits within 0–15", () => {
    const store = fresh();
    store.addClip("amiibo");
    const track = store.project.tracks.find((t) => t.type === "amiibo")!;
    const clip = track.clips[0]!;
    expect(store.updateClipField(track.id, clip.id, "slot", 15)).toBe(true);
    expect((clip as { slot: number }).slot).toBe(15);
    expect(store.validate()).toBeNull();
  });

  it("rejects slot edits outside 0–15 in the editor", () => {
    const store = fresh();
    store.addClip("amiibo");
    const track = store.project.tracks.find((t) => t.type === "amiibo")!;
    const clip = track.clips[0]!;
    const ok = store.updateClipField(track.id, clip.id, "slot", 16);
    expect(ok).toBe(false);
    expect(store.validationError).toMatch(/0–15/);
    expect((clip as { slot: number }).slot).toBe(0);
  });

  it("flags out-of-range slots in validate (timeline-model only checks >= 0)", () => {
    const store = fresh();
    store.addClip("amiibo");
    const track = store.project.tracks.find((t) => t.type === "amiibo")!;
    const clip = track.clips[0]!;
    (clip as { slot: number }).slot = 99; // bypass the editor gate
    const err = store.validate();
    expect(err).toMatch(/0–15/);
    expect(store.validationError).toMatch(/0–15/);
    // package layer allows it; the S10 thin layer catches it here.
    expect(() => validateProject(store.project)).not.toThrow();
  });

  it("copy + paste duplicates an amiibo clip at the playhead", () => {
    const store = fresh();
    store.setPlayhead(200);
    store.addClip("amiibo");
    const track = store.project.tracks.find((t) => t.type === "amiibo")!;
    const src = track.clips[0]!;
    store.selectOnly(src.id);
    store.copySelected();
    store.setPlayhead(3000);
    store.paste();
    const clips = store.project.tracks.find((t) => t.type === "amiibo")!.clips;
    expect(clips).toHaveLength(2);
    expect((clips[1] as { slot: number }).slot).toBe(0);
    expect(store.validate()).toBeNull();
  });
});
import { nameToButton } from "@ns2-studio/pad-types";
import { ProjectValidationError } from "./errors";
import {
  PROJECT_MAGIC,
  PROJECT_VERSION,
  type AmiiboClip,
  type ButtonClip,
  type HatClip,
  type MarkerClip,
  type Project,
  type StickClip,
  type StickKeyframe,
  type Track,
} from "./types";

const TRACK_TYPES = new Set(["buttons", "stick", "hat", "amiibo", "marker"]);

function fail(code: string, message: string): never {
  throw new ProjectValidationError(code, message);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`invalid.${what}`, `${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`invalid.${what}`, `${what} must be a finite number`);
  }
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") {
    fail(`invalid.${what}`, `${what} must be a string`);
  }
  return value;
}

function asClipList(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`invalid.${what}`, `${what} must be an array`);
  }
  return value;
}

function asStartEnd(value: Record<string, unknown>, what: string): [number, number] {
  const startMs = asFiniteNumber(value.startMs, `${what}.startMs`);
  const endMs = asFiniteNumber(value.endMs, `${what}.endMs`);
  if (startMs < 0 || endMs < 0) {
    fail("clip.negative.time", `${what} times must be non-negative`);
  }
  if (endMs < startMs) {
    fail(
      "clip.time.inversion",
      `${what} has endMs ${endMs} < startMs ${startMs}`,
    );
  }
  return [startMs, endMs];
}

function asId(value: Record<string, unknown>, what: string): string {
  return asString(value.id, `${what}.id`);
}

function validateButtonClip(
  raw: Record<string, unknown>,
  clipId: string,
): ButtonClip {
  const [startMs, endMs] = asStartEnd(raw, `clip ${clipId}`);
  const key = asString(raw.key, `clip ${clipId}.key`);
  try {
    nameToButton(key);
  } catch {
    fail("clip.unknown.key", `clip ${clipId} has unknown button key "${key}"`);
  }
  return { id: clipId, key, startMs, endMs };
}

function validateStickKeyframes(
  raw: unknown,
  clipId: string,
): StickKeyframe[] {
  const list = asClipList(raw, `clip ${clipId}.keyframes`);
  if (list.length === 0) {
    fail("clip.empty.keyframes", `clip ${clipId} must have at least one keyframe`);
  }
  let lastOffset = -1;
  const out: StickKeyframe[] = [];
  list.forEach((item, i) => {
    const kf = asRecord(item, `clip ${clipId}.keyframes[${i}]`);
    const offsetMs = asFiniteNumber(kf.offsetMs, `keyframe ${i}.offsetMs`);
    const x = asFiniteNumber(kf.x, `keyframe ${i}.x`);
    const y = asFiniteNumber(kf.y, `keyframe ${i}.y`);
    if (offsetMs < 0 || x < 0 || y < 0 || x > 255 || y > 255) {
      fail(
        "clip.keyframe.range",
        `clip ${clipId} keyframe ${i} is out of range`,
      );
    }
    if (offsetMs <= lastOffset) {
      fail(
        "clip.keyframe.order",
        `clip ${clipId} keyframes must be strictly increasing`,
      );
    }
    lastOffset = offsetMs;
    out.push({ offsetMs, x, y });
  });
  return out;
}

function validateStickClip(raw: Record<string, unknown>, clipId: string): StickClip {
  const [startMs, endMs] = asStartEnd(raw, `clip ${clipId}`);
  const keyframes = validateStickKeyframes(raw.keyframes, clipId);
  return { id: clipId, startMs, endMs, keyframes };
}

function validateHatClip(raw: Record<string, unknown>, clipId: string): HatClip {
  const [startMs, endMs] = asStartEnd(raw, `clip ${clipId}`);
  const hat = asFiniteNumber(raw.hat, `clip ${clipId}.hat`);
  if (!Number.isInteger(hat) || hat < 0 || hat > 8) {
    fail("clip.hat.range", `clip ${clipId} hat must be an integer 0-8`);
  }
  return { id: clipId, startMs, endMs, hat };
}

function validateAmiiboClip(raw: Record<string, unknown>, clipId: string): AmiiboClip {
  const [startMs, endMs] = asStartEnd(raw, `clip ${clipId}`);
  const slot = asFiniteNumber(raw.slot, `clip ${clipId}.slot`);
  if (!Number.isInteger(slot) || slot < 0) {
    fail("clip.slot.range", `clip ${clipId} slot must be a non-negative integer`);
  }
  return { id: clipId, startMs, endMs, slot };
}

function validateMarkerClip(raw: Record<string, unknown>, clipId: string): MarkerClip {
  const [startMs, endMs] = asStartEnd(raw, `clip ${clipId}`);
  const label = asString(raw.label, `clip ${clipId}.label`);
  return { id: clipId, startMs, endMs, label };
}

/**
 * Validates an unknown project shape and returns a normalized `Project`.
 * Throws `ProjectValidationError` with a stable `code` on any violation.
 */
export function validateProject(input: unknown): Project {
  const root = asRecord(input, "project");

  if (root.magic !== PROJECT_MAGIC) {
    fail("project.magic", `project magic must be "${PROJECT_MAGIC}"`);
  }
  if (root.version !== PROJECT_VERSION) {
    fail("project.version", `project version must be ${PROJECT_VERSION}`);
  }

  const name = asString(root.name, "project.name");
  const durationMs = asFiniteNumber(root.durationMs, "project.durationMs");
  if (durationMs < 0) {
    fail("project.duration", "project.durationMs must be non-negative");
  }
  const gridMs = asFiniteNumber(root.gridMs, "project.gridMs");
  if (gridMs <= 0) {
    fail("project.grid", "project.gridMs must be positive");
  }

  if (!Array.isArray(root.tracks)) {
    fail("project.tracks", "project.tracks must be an array");
  }

  const seenTrackIds = new Set<string>();
  const seenClipIds = new Set<string>();
  const tracks: Track[] = [];

  (root.tracks as unknown[]).forEach((rawTrack, ti) => {
    const track = asRecord(rawTrack, `tracks[${ti}]`);
    const trackId = asId(track, `track ${ti}`);
    if (seenTrackIds.has(trackId)) {
      fail("track.id.conflict", `duplicate track id "${trackId}"`);
    }
    seenTrackIds.add(trackId);

    const type = asString(track.type, `track ${trackId}.type`);
    if (!TRACK_TYPES.has(type)) {
      fail("track.type", `track ${trackId} has unknown type "${type}"`);
    }

    const rawClips = asClipList(track.clips, `track ${trackId}.clips`);

    const pushClip = (clipId: string): void => {
      if (seenClipIds.has(clipId)) {
        fail("clip.id.conflict", `duplicate clip id "${clipId}"`);
      }
      seenClipIds.add(clipId);
    };

    if (type === "buttons") {
      const clips: ButtonClip[] = [];
      rawClips.forEach((item, ci) => {
        const clip = asRecord(item, `track ${trackId}.clips[${ci}]`);
        const clipId = asId(clip, `clip ${ci}`);
        pushClip(clipId);
        clips.push(validateButtonClip(clip, clipId));
      });
      tracks.push({ id: trackId, type: "buttons", clips });
      return;
    }

    if (type === "stick") {
      const stick = asString(track.stick, `track ${trackId}.stick`);
      if (stick !== "L" && stick !== "R") {
        fail("track.stick", `track ${trackId}.stick must be "L" or "R"`);
      }
      const clips: StickClip[] = [];
      rawClips.forEach((item, ci) => {
        const clip = asRecord(item, `track ${trackId}.clips[${ci}]`);
        const clipId = asId(clip, `clip ${ci}`);
        pushClip(clipId);
        clips.push(validateStickClip(clip, clipId));
      });
      tracks.push({ id: trackId, type: "stick", stick, clips });
      return;
    }

    if (type === "hat") {
      const clips: HatClip[] = [];
      rawClips.forEach((item, ci) => {
        const clip = asRecord(item, `track ${trackId}.clips[${ci}]`);
        const clipId = asId(clip, `clip ${ci}`);
        pushClip(clipId);
        clips.push(validateHatClip(clip, clipId));
      });
      tracks.push({ id: trackId, type: "hat", clips });
      return;
    }

    if (type === "amiibo") {
      const clips: AmiiboClip[] = [];
      rawClips.forEach((item, ci) => {
        const clip = asRecord(item, `track ${trackId}.clips[${ci}]`);
        const clipId = asId(clip, `clip ${ci}`);
        pushClip(clipId);
        clips.push(validateAmiiboClip(clip, clipId));
      });
      tracks.push({ id: trackId, type: "amiibo", clips });
      return;
    }

    const clips: MarkerClip[] = [];
    rawClips.forEach((item, ci) => {
      const clip = asRecord(item, `track ${trackId}.clips[${ci}]`);
      const clipId = asId(clip, `clip ${ci}`);
      pushClip(clipId);
      clips.push(validateMarkerClip(clip, clipId));
    });
    tracks.push({ id: trackId, type: "marker", clips });
  });

  return {
    magic: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    name,
    durationMs,
    gridMs,
    tracks,
  };
}

/** hat 轨道重叠警告（后写覆盖不视为错误）。 */
export function hatConflictWarnings(project: Project): string[] {
  const warnings: string[] = [];
  const hatClips = project.tracks.flatMap((t) =>
    t.type === "hat" ? t.clips : [],
  );
  for (let i = 0; i < hatClips.length; i++) {
    for (let j = i + 1; j < hatClips.length; j++) {
      const a = hatClips[i]!;
      const b = hatClips[j]!;
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        warnings.push(`hat clips ${a.id} and ${b.id} overlap`);
      }
    }
  }
  return warnings;
}
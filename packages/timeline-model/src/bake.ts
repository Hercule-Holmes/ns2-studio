import {
  SwitchButton,
  type TimedPadReport,
} from "@ns2-studio/pad-types";
import { ProjectValidationError } from "./errors";
import {
  PROJECT_MAGIC,
  PROJECT_VERSION,
  RECORDING_MAGIC,
  RECORDING_VERSION,
  type BakeOptions,
  type ButtonClip,
  type Project,
  type Recording,
  type StickClip,
  type StickKeyframe,
  type Track,
} from "./types";

function deadZoneValue(v: number, deadZone: number): number {
  return Math.abs(v - 128) < deadZone ? 128 : v;
}

function usToMs(tUs: number): number {
  return Math.round(tUs / 1000);
}

function detectButtonClips(
  frames: TimedPadReport[],
  durationMs: number,
): ButtonClip[] {
  const clips: ButtonClip[] = [];
  const pressStart = new Map<number, number>();

  const names = Object.keys(SwitchButton) as (keyof typeof SwitchButton)[];

  for (const frame of frames) {
    const tMs = usToMs(frame.tUs);
    for (const name of names) {
      const bit = SwitchButton[name];
      const pressed = (frame.buttons & bit) !== 0;
      if (pressed && !pressStart.has(bit)) {
        pressStart.set(bit, tMs);
      } else if (!pressed && pressStart.has(bit)) {
        const startMs = pressStart.get(bit)!;
        pressStart.delete(bit);
        clips.push({ id: `btn_${name}_${clips.length}`, key: name, startMs, endMs: tMs });
      }
    }
  }

  for (const name of names) {
    const bit = SwitchButton[name];
    if (pressStart.has(bit)) {
      const startMs = pressStart.get(bit)!;
      pressStart.delete(bit);
      clips.push({ id: `btn_${name}_${clips.length}`, key: name, startMs, endMs: durationMs });
    }
  }

  clips.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return clips;
}

function detectStickClip(
  stick: "L" | "R",
  frames: TimedPadReport[],
  opts: BakeOptions,
  durationMs: number,
): StickClip | null {
  const decimation = Math.max(1, Math.floor(opts.stickDecimation ?? 1));
  const deadZone = Math.max(0, opts.deadZone ?? 4);

  const points: { tMs: number; x: number; y: number }[] = [];
  for (let i = 0; i < frames.length; i += decimation) {
    const f = frames[i]!;
    const tMs = usToMs(f.tUs);
    const x = deadZoneValue(stick === "L" ? f.lx : f.rx, deadZone);
    const y = deadZoneValue(stick === "L" ? f.ly : f.ry, deadZone);
    points.push({ tMs, x, y });
  }

  const keyframes: StickKeyframe[] = [];
  for (const pt of points) {
    const prev = keyframes[keyframes.length - 1];
    if (prev && prev.x === pt.x && prev.y === pt.y) continue;
    keyframes.push({ offsetMs: pt.tMs, x: pt.x, y: pt.y });
  }

  const nonNeutral = keyframes.some((k) => k.x !== 128 || k.y !== 128);
  if (keyframes.length === 0 || !nonNeutral) return null;

  const startMs = keyframes[0]!.offsetMs;
  const endMs = keyframes[keyframes.length - 1]!.offsetMs;

  const clip: StickClip = {
    id: `stick_${stick}_0`,
    startMs,
    endMs: Math.max(endMs, Math.min(startMs + 1, durationMs)),
    keyframes: keyframes.map((k) => ({ offsetMs: k.offsetMs - startMs, x: k.x, y: k.y })),
  };
  return clip;
}

/**
 * 从录制帧流烘焙出工程（MVP：按键边沿 → button clips；摇杆可选降采样 + 死区）。
 * 纯函数，不依赖 electron/fs。
 */
export function bake(rec: unknown, opts: BakeOptions = {}): Project {
  if (rec === null || typeof rec !== "object" || Array.isArray(rec)) {
    throw new ProjectValidationError("recording.shape", "recording must be an object");
  }
  const r = rec as Partial<Recording>;
  if (r.magic !== RECORDING_MAGIC) {
    throw new ProjectValidationError("recording.magic", `recording magic must be "${RECORDING_MAGIC}"`);
  }
  if (r.version !== RECORDING_VERSION) {
    throw new ProjectValidationError("recording.version", `recording version must be ${RECORDING_VERSION}`);
  }
  if (!Array.isArray(r.frames)) {
    throw new ProjectValidationError("recording.frames", "recording frames must be an array");
  }
  const frames = r.frames as TimedPadReport[];

  let prevTUs = -Infinity;
  for (const frame of frames) {
    if (typeof frame.tUs !== "number" || !Number.isFinite(frame.tUs)) {
      throw new ProjectValidationError("recording.frame.time", "frame tUs must be a finite number");
    }
    if (frame.tUs < prevTUs) {
      throw new ProjectValidationError("recording.frame.order", "frames must be in non-decreasing tUs order");
    }
    prevTUs = frame.tUs;
  }

  const lastTUs = frames.length > 0 ? frames[frames.length - 1]!.tUs : 0;
  const durationMs = Math.max(0, Math.ceil(lastTUs / 1000));
  const name = opts.name ?? "Baked Recording";
  const gridMs = opts.gridMs ?? 10;

  const tracks: Track[] = [];

  const buttonClips = detectButtonClips(frames, durationMs);
  if (buttonClips.length > 0) {
    tracks.push({ id: "track_buttons", type: "buttons", clips: buttonClips });
  }

  const stickL = detectStickClip("L", frames, opts, durationMs);
  const stickR = detectStickClip("R", frames, opts, durationMs);
  if (stickL) {
    tracks.push({ id: "track_stick_l", type: "stick", stick: "L", clips: [stickL] });
  }
  if (stickR) {
    tracks.push({ id: "track_stick_r", type: "stick", stick: "R", clips: [stickR] });
  }

  return {
    magic: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    name,
    durationMs,
    gridMs,
    tracks,
  };
}
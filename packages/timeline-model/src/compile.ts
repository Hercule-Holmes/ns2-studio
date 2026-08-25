import {
  SwitchHat,
  clampStick,
  nameToButton,
  type TimedPadReport,
} from "@ns2-studio/pad-types";
import { validateProject } from "./validate";
import type {
  AmiiboEvent,
  CompileResult,
  Project,
  StickClip,
} from "./types";

interface ButtonSeg {
  bit: number;
  startMs: number;
  endMs: number;
}

interface StickSeg {
  stick: "L" | "R";
  clip: StickClip;
}

function lerpStick(clip: StickClip, tMs: number): { x: number; y: number } {
  const local = tMs - clip.startMs;
  const kfs = clip.keyframes;
  const first = kfs[0]!;
  if (local <= first.offsetMs) return { x: first.x, y: first.y };

  const last = kfs[kfs.length - 1]!;
  if (local >= last.offsetMs) return { x: last.x, y: last.y };

  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (local >= a.offsetMs && local <= b.offsetMs) {
      const span = b.offsetMs - a.offsetMs;
      const ratio = span === 0 ? 0 : (local - a.offsetMs) / span;
      return {
        x: clampStick(a.x + (b.x - a.x) * ratio),
        y: clampStick(a.y + (b.y - a.y) * ratio),
      };
    }
  }
  return { x: last.x, y: last.y };
}

/**
 * 将工程编译为等间隔采样帧流（纯函数，不依赖 electron/fs）。
 * 采样步长 = 1000/hz ms，覆盖 [0, durationMs]。
 */
export function compile(project: Project, opts: { hz: number }): CompileResult {
  const p = validateProject(project);
  const hz = opts.hz;
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new Error("compile: hz must be a positive finite number");
  }
  const stepMs = 1000 / hz;

  const buttonSegs: ButtonSeg[] = [];
  const stickSegs: StickSeg[] = [];
  const hatSegs: { hat: number; startMs: number; endMs: number }[] = [];
  const amiiboEvents: AmiiboEvent[] = [];

  for (const track of p.tracks) {
    if (track.type === "buttons") {
      for (const clip of track.clips) {
        buttonSegs.push({
          bit: nameToButton(clip.key),
          startMs: clip.startMs,
          endMs: clip.endMs,
        });
      }
    } else if (track.type === "stick") {
      for (const clip of track.clips) {
        stickSegs.push({ stick: track.stick, clip });
      }
    } else if (track.type === "hat") {
      for (const clip of track.clips) {
        hatSegs.push({ hat: clip.hat, startMs: clip.startMs, endMs: clip.endMs });
      }
    } else if (track.type === "amiibo") {
      for (const clip of track.clips) {
        amiiboEvents.push({ tUs: clip.startMs * 1000, slot: clip.slot });
      }
    }
  }

  const frameCount = Math.floor(p.durationMs / stepMs) + 1;
  const frames: TimedPadReport[] = [];

  for (let i = 0; i < frameCount; i++) {
    const tMs = i * stepMs;

    let buttons = 0;
    for (const seg of buttonSegs) {
      if (tMs >= seg.startMs && tMs < seg.endMs) buttons |= seg.bit;
    }

    let lx = 128;
    let ly = 128;
    let rx = 128;
    let ry = 128;
    for (const seg of stickSegs) {
      if (tMs >= seg.clip.startMs && tMs < seg.clip.endMs) {
        const v = lerpStick(seg.clip, tMs);
        if (seg.stick === "L") {
          lx = v.x;
          ly = v.y;
        } else {
          rx = v.x;
          ry = v.y;
        }
      }
    }

    let hat: number = SwitchHat.CENTER;
    for (const seg of hatSegs) {
      if (tMs >= seg.startMs && tMs < seg.endMs) hat = seg.hat;
    }

    frames.push({
      tUs: Math.round(tMs * 1000),
      buttons,
      hat,
      lx,
      ly,
      rx,
      ry,
    });
  }

  return { frames, amiiboEvents };
}
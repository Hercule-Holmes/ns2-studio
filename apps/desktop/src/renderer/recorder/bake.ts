/**
 * S7 bake entry helper (renderer). Wraps timeline-model `bake` with the two
 * UI options S7 exposes: stick dead zone (passed straight through) and a
 * minimum button-press duration (filters too-short button clips after baking;
 * timeline-model has no such option).
 */
import { bake } from "@ns2-studio/timeline-model";
import type { Project, Recording } from "@ns2-studio/timeline-model";

export interface BakeRecordingOptions {
  name: string;
  /** 摇杆死区：|v-128| < d 视为中立 */
  deadZone: number;
  /** 丢弃时长短于该值的 button clips（ms）；<=0 不过滤 */
  minButtonMs: number;
}

export function bakeRecording(
  rec: Recording,
  opts: BakeRecordingOptions,
): Project {
  const project = bake(rec, { name: opts.name, deadZone: opts.deadZone });
  if (opts.minButtonMs <= 0) return project;
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === "buttons"
        ? {
            ...track,
            clips: track.clips.filter(
              (clip) => clip.endMs - clip.startMs >= opts.minButtonMs,
            ),
          }
        : track,
    ),
  };
}
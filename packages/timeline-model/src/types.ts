import type { TimedPadReport } from "@ns2-studio/pad-types";

export const PROJECT_MAGIC = "NSPROJ" as const;
export const PROJECT_VERSION = 1 as const;

export const RECORDING_MAGIC = "NSREC" as const;
export const RECORDING_VERSION = 1 as const;

export type TrackType = "buttons" | "stick" | "hat" | "amiibo" | "marker";
export type StickName = "L" | "R";
export type RecordingSource = "forward" | "manual" | "timeline";

export interface ButtonClip {
  id: string;
  key: string;
  startMs: number;
  endMs: number;
}

export interface StickKeyframe {
  offsetMs: number;
  x: number;
  y: number;
}

export interface StickClip {
  id: string;
  startMs: number;
  endMs: number;
  keyframes: StickKeyframe[];
}

export interface HatClip {
  id: string;
  startMs: number;
  endMs: number;
  hat: number;
}

export interface AmiiboClip {
  id: string;
  startMs: number;
  endMs: number;
  slot: number;
}

export interface MarkerClip {
  id: string;
  startMs: number;
  endMs: number;
  label: string;
}

export interface ButtonsTrack {
  id: string;
  type: "buttons";
  clips: ButtonClip[];
}

export interface StickTrack {
  id: string;
  type: "stick";
  stick: StickName;
  clips: StickClip[];
}

export interface HatTrack {
  id: string;
  type: "hat";
  clips: HatClip[];
}

export interface AmiiboTrack {
  id: string;
  type: "amiibo";
  clips: AmiiboClip[];
}

export interface MarkerTrack {
  id: string;
  type: "marker";
  clips: MarkerClip[];
}

export type Track = ButtonsTrack | StickTrack | HatTrack | AmiiboTrack | MarkerTrack;

export interface Project {
  magic: typeof PROJECT_MAGIC;
  version: typeof PROJECT_VERSION;
  name: string;
  durationMs: number;
  gridMs: number;
  tracks: Track[];
}

export interface Recording {
  magic: typeof RECORDING_MAGIC;
  version: typeof RECORDING_VERSION;
  meta: {
    createdAt: string;
    source: RecordingSource;
    deviceName: string;
    tickHz: number;
  };
  frames: TimedPadReport[];
}

export interface AmiiboEvent {
  tUs: number;
  slot: number;
}

export interface CompileResult {
  frames: TimedPadReport[];
  amiiboEvents: AmiiboEvent[];
}

export interface BakeOptions {
  name?: string;
  gridMs?: number;
  /** 摇杆降采样：每 N 帧取一帧（简单步进），默认 1 */
  stickDecimation?: number;
  /** 死区：|v-128| < d 视为中立 */
  deadZone?: number;
}
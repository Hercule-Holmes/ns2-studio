import type { PadReport } from "@ns2-studio/pad-types";
import type { RecordingSource } from "@ns2-studio/timeline-model";

/**
 * Typed IPC contracts shared by main / preload / renderer.
 *
 * Naming convention (from 01-SYSTEM-ARCHITECTURE.md §6):
 *   - `device:*` 双向：连接、版本、reset
 *   - `log:*`    M→R：日志流
 * Future domains (hub / timeline / capture / amiibo) extend this file.
 */

export type DeviceState =
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "connected"
  | "error";

export interface DeviceStatus {
  state: DeviceState;
  path?: string;
  baud?: number;
  version?: string;
  error?: string;
}

export interface ConnectResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export type LogDirection = "tx" | "rx" | "info" | "warn" | "error";

export interface LogLine {
  /** epoch ms */
  ts: number;
  dir: LogDirection;
  text: string;
  /** hex dump of the frame for tx/rx lines (optional, controlled by hexLog) */
  hex?: string;
}

export interface AppSettings {
  lastPort?: string;
  lastBaud?: number;
}

/**
 * Application configuration (03-DATA-MODELS.md §6). Persisted at
 * `userData/config.json`.
 */
export interface AppConfig {
  serial: { path?: string; baud: number; minIntervalMs: number };
  capture: { deviceId?: string; tickHz: number; triggerThreshold: number; swapABXY: boolean };
  timeline: { defaultHz: number; gridMs: number };
  ui: { theme: "dark" | "light" };
}

/** Recursive partial so renderer may patch a single nested config field. */
export type DeepPartialAppConfig = {
  [K in keyof AppConfig]?: AppConfig[K] extends object
    ? {
        [P in keyof AppConfig[K]]?: AppConfig[K][P] extends object
          ? DeepPartial<AppConfig[K][P]>
          : AppConfig[K][P];
      }
    : AppConfig[K];
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ConfigApi {
  get(): Promise<AppConfig>;
  update(patch: DeepPartialAppConfig): Promise<AppConfig>;
}

export interface AppInfo {
  name: string;
  version: string;
}

export interface AppInfoApi {
  getInfo(): Promise<AppInfo>;
  /** Forward a renderer-side error string to the main crash log. */
  reportError(detail: string): Promise<void>;
}

export interface DeviceApi {
  listPorts(): Promise<string[]>;
  connect(path: string, baud?: number): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  getStatus(): Promise<DeviceStatus>;
  sendNeutral(): Promise<void>;
  /** Debug-only: push a raw report through the main write queue. */
  sendReport(report: PadReport): Promise<void>;
  subscribeLog(): Promise<LogLine[]>;
  onStateChanged(cb: (status: DeviceStatus) => void): () => void;
  onLog(cb: (line: LogLine) => void): () => void;
}

export interface SettingsApi {
  get(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<void>;
}

/** Active output source of InputHub (01-SYSTEM-ARCHITECTURE.md §4). */
export type HubSource = "idle" | "manual" | "forward" | "timeline";

export interface HubState {
  activeSource: HubSource;
}

export interface HubApi {
  setSource(source: HubSource): Promise<HubState>;
  getState(): Promise<HubState>;
  forceNeutral(): Promise<void>;
  onStateChanged(cb: (state: HubState) => void): () => void;
}

export interface PadApi {
  /** Submit a report from the virtual pad; ignored unless manual is active. */
  apply(report: PadReport): Promise<void>;
  reset(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Recording (S7)
// ---------------------------------------------------------------------------

export type RecorderState = "idle" | "recording";

export interface RecorderStopResult {
  ok: boolean;
  /** nsrec JSON text of the finished recording when ok */
  content?: string;
  error?: string;
}

/**
 * Frame-recording API (S7). The main-process Recorder subscribes to the
 * reports the InputHub actually dispatches and stamps them with tUs from the
 * start instant. File I/O mirrors the S5 project dialog pattern: the renderer
 * only holds the parsed Recording object, all file I/O goes through main.
 */
export interface RecordingApi {
  /** Begin capturing. `source` records what was being output ("manual"|"forward"). */
  start(source: RecordingSource): Promise<RecorderState>;
  /** Neutralize the device and finalize the recording; returns nsrec text. */
  stop(): Promise<RecorderStopResult>;
  /** Drop the in-memory frames and return to idle. */
  reset(): Promise<void>;
  getState(): Promise<RecorderState>;
  onStateChanged(cb: (state: RecorderState) => void): () => void;
  /** showOpenDialog + readFile; returns raw nsrec text, parsed in the renderer. */
  open(): Promise<ProjectOpenResult>;
  /** Write `content`; when `path` is null a save dialog is shown. */
  save(path: string | null, content: string, defaultName: string): Promise<ProjectSaveResult>;
}

export interface ProjectOpenResult {
  ok: boolean;
  /** present when ok */
  path?: string;
  /** file text content when ok */
  content?: string;
  /** user dismissed the dialog */
  canceled?: boolean;
  error?: string;
}

export interface ProjectSaveResult {
  ok: boolean;
  /** resolved file path when ok (dialog may normalize it) */
  path?: string;
  canceled?: boolean;
  error?: string;
}

/**
 * Timeline project file API (S5). The renderer only holds the project
 * object in its store; all file I/O goes through main `dialog` + fs.
 */
export interface ProjectApi {
  /** showOpenDialog + readFile; returns raw text, parsed in the renderer. */
  open(): Promise<ProjectOpenResult>;
  /**
   * Write `content`. When `path` is null a save dialog is shown with
   * `defaultName` (e.g. `名称.nsproj.json`); returns the final path.
   */
  save(path: string | null, content: string, defaultName: string): Promise<ProjectSaveResult>;
}

/** `window.api` surface exposed by the preload script. */
export interface RendererApi {
  device: DeviceApi;
  settings: SettingsApi;
  config: ConfigApi;
  appInfo: AppInfoApi;
  hub: HubApi;
  pad: PadApi;
  project: ProjectApi;
  recorder: RecordingApi;
  timeline: TimelineApi;
  amiibo: AmiiboApi;
  capture: CaptureApi;
}

// ---------------------------------------------------------------------------
// Amiibo (S9)
// ---------------------------------------------------------------------------

export interface AmiiboItem {
  id: string; // uuid
  name: string;
  fileName: string; // e.g. "<uuid>.bin"
  /** relative to userData/amiibo/ */
  relPath: string;
  size: number;
  /** optional: parsed character name from the bin */
  character?: string;
  lastSlot?: number;
}

export type AmiiboCapability = "true" | "false" | "unknown";

export interface AmiiboCapabilities {
  amiibo: AmiiboCapability;
  connected: boolean;
}

export interface AmiiboProgress {
  slot: number;
  sent: number;
  total: number;
}

export type AmiiboSaveResult =
  | { ok: true; slot: number; sent: number; total: number }
  | { ok: false; code: string; message: string };

export type AmiiboChangeResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export interface AmiiboApi {
  list(): Promise<AmiiboItem[]>;
  /** Open a file dialog and import the picked dump; null if cancelled. */
  pickAndImport(): Promise<AmiiboItem | null>;
  rename(id: string, name: string): Promise<AmiiboItem>;
  remove(id: string): Promise<void>;
  getCapabilities(): Promise<AmiiboCapabilities>;
  saveToSlot(slot: number, id: string): Promise<AmiiboSaveResult>;
  changeIndex(slot: number): Promise<AmiiboChangeResult>;
  cancel(): Promise<void>;
  onProgress(cb: (p: AmiiboProgress) => void): () => void;
  onCapabilitiesChanged(cb: (c: AmiiboCapabilities) => void): () => void;
}

// ---------------------------------------------------------------------------
// NS2 Pro capture (S8)
// ---------------------------------------------------------------------------

export type CaptureState =
  | "idle"
  | "connecting"
  | "streaming"
  | "unsupported"
  | "error";

export interface CaptureDeviceInfo {
  path: string;
  vid: number;
  pid: number;
  product?: string;
  manufacturer?: string;
  serialNumber?: string;
}

export interface CaptureStatus {
  state: CaptureState;
  device?: CaptureDeviceInfo;
  /** Which init transport succeeded. `listen-only` = default reports only. */
  initMode: "output-report" | "listen-only";
  error?: string;
  /** node-hid native module load failure, if any (graceful degradation). */
  loadError?: string;
}

export interface CaptureStartResult {
  ok: boolean;
  error?: string;
}

/**
 * Wired NS2 Pro capture + forward (S8). The renderer never touches HID; it
 * lists devices and starts/stops the capture loop in the main process, which
 * feeds the InputHub `forward` source.
 */
export interface CaptureApi {
  list(): Promise<CaptureDeviceInfo[]>;
  start(path?: string): Promise<CaptureStartResult>;
  stop(): Promise<void>;
  getStatus(): Promise<CaptureStatus>;
  onStateChanged(cb: (status: CaptureStatus) => void): () => void;
}

// ---------------------------------------------------------------------------
// Timeline playback (S6)
// ---------------------------------------------------------------------------

export type TimelinePlaybackReason = "end" | "user" | "device-lost" | "error";

export interface TimelinePlaybackState {
  playing: boolean;
  /** set on non-start transitions (end / user / device-lost / error) */
  reason?: TimelinePlaybackReason;
  positionMs: number;
  durationMs: number;
  /** true when running in dry-run (device not driving, head only) */
  dryRun: boolean;
}

export interface TimelineLoadResult {
  ok: boolean;
  durationMs?: number;
  frameCount?: number;
  error?: string;
}

export interface TimelinePlayResult {
  ok: boolean;
  playing: boolean;
  dryRun?: boolean;
  error?: string;
}

/**
 * Playback API (S6). `load` accepts a validated project object (or a compiled
 * `CompileResult`); the renderer sends its in-memory store.project.
 */
export interface TimelineApi {
  load(input: unknown, opts?: { hz?: number }): Promise<TimelineLoadResult>;
  play(opts?: { dryRun?: boolean }): Promise<TimelinePlayResult>;
  pause(): Promise<TimelinePlaybackState>;
  stop(): Promise<TimelinePlaybackState>;
  seek(ms: number): Promise<TimelinePlaybackState>;
  /** M→R head position, throttled to 30–60fps. */
  onTime(cb: (ms: number) => void): () => void;
  onState(cb: (state: TimelinePlaybackState) => void): () => void;
}
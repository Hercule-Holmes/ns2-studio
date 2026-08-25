/**
 * Main-process frame recorder (S7). Subscribes to the reports the InputHub
 * actually dispatches (via the `reportSent` hook on its device-write path) and
 * stamps them with monotonic tUs from the start instant. Pure-ish: the clock
 * and the report source are injected so unit tests need no electron/serial.
 */
import type { PadReport, TimedPadReport } from "@ns2-studio/pad-types";
import {
  RECORDING_MAGIC,
  RECORDING_VERSION,
} from "@ns2-studio/timeline-model";
import type { Recording, RecordingSource } from "@ns2-studio/timeline-model";
import type { RecorderState } from "../../shared/ipc";

export interface RecorderClock {
  /** Monotonic microseconds. Defaults to performance.now()*1000. */
  nowUs(): number;
}

export interface RecorderReportSource {
  /** Subscribe to every report the hub sends to the device. Returns unsubscribe. */
  onReport(cb: (report: PadReport) => void): () => void;
  /** Neutralize the device; the neutral report also flows through onReport. */
  forceNeutral(): Promise<void>;
}

export interface RecorderOptions {
  tickHz?: number;
  /** Skip consecutive identical reports (replay holds the last frame). */
  compression?: boolean;
  deviceName?: string;
  clock?: RecorderClock;
}

function sameReport(a: PadReport, b: PadReport): boolean {
  return (
    a.buttons === b.buttons &&
    a.hat === b.hat &&
    a.lx === b.lx &&
    a.ly === b.ly &&
    a.rx === b.rx &&
    a.ry === b.ry
  );
}

export class Recorder {
  private state: RecorderState = "idle";
  private frames: TimedPadReport[] = [];
  private lastReport: PadReport | null = null;
  private startUs = 0;
  private sourceLabel: RecordingSource = "manual";

  private readonly tickHz: number;
  private readonly compression: boolean;
  private readonly deviceName: string;
  private readonly clock: RecorderClock;
  private readonly reportSource: RecorderReportSource;

  private offReport: () => void;
  private stateListeners = new Set<(state: RecorderState) => void>();

  constructor(reportSource: RecorderReportSource, opts: RecorderOptions = {}) {
    this.reportSource = reportSource;
    this.tickHz = opts.tickHz ?? 250;
    this.compression = opts.compression ?? true;
    this.deviceName = opts.deviceName ?? "NS2 Pro";
    this.clock = opts.clock ?? { nowUs: () => Math.round(performance.now() * 1000) };
    this.offReport = () => {};
  }

  getState(): RecorderState {
    return this.state;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get durationUs(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1]!.tUs : 0;
  }

  onStateChanged(cb: (state: RecorderState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  start(source: RecordingSource): void {
    if (this.state === "recording") return;
    this.sourceLabel = source;
    this.frames = [];
    this.lastReport = null;
    this.startUs = this.clock.nowUs();
    this.state = "recording";
    this.offReport = this.reportSource.onReport((report) => this.onReport(report));
    this.emitState();
  }

  /**
   * Neutralize the device first so a held key is not left pressed, then
   * finalize. Returns null if not recording.
   */
  async stop(): Promise<Recording | null> {
    if (this.state !== "recording") return null;
    await this.reportSource.forceNeutral();
    this.offReport();
    this.state = "idle";
    this.emitState();
    return this.toRecording();
  }

  reset(): void {
    this.offReport();
    this.state = "idle";
    this.frames = [];
    this.lastReport = null;
    this.emitState();
  }

  private onReport(report: PadReport): void {
    if (this.state !== "recording") return;
    const tUs = Math.max(0, this.clock.nowUs() - this.startUs);
    if (this.compression && this.lastReport && sameReport(this.lastReport, report)) {
      return;
    }
    this.frames.push({ tUs, ...report });
    this.lastReport = { ...report };
  }

  private toRecording(): Recording {
    return {
      magic: RECORDING_MAGIC,
      version: RECORDING_VERSION,
      meta: {
        createdAt: new Date().toISOString(),
        source: this.sourceLabel,
        deviceName: this.deviceName,
        tickHz: this.tickHz,
      },
      frames: this.frames,
    };
  }

  private emitState(): void {
    for (const listener of this.stateListeners) listener(this.state);
  }
}
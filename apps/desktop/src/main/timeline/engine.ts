import type {
  AmiiboEvent,
  CompileResult,
  Project,
} from "@ns2-studio/timeline-model";
import { compile } from "@ns2-studio/timeline-model";
import type { PadReport, TimedPadReport } from "@ns2-studio/pad-types";
import type { HubSource } from "../../shared/ipc";

type EventMap = Record<string, (...args: never[]) => void>;

class TypedEmitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: Set<E[K]> } = {};

  on<K extends keyof E>(event: K, cb: E[K]): () => void {
    (this.listeners[event] ??= new Set()).add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof E>(event: K, cb: E[K]): void {
    this.listeners[event]?.delete(cb);
  }

  protected emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    this.listeners[event]?.forEach((cb) => cb(...args));
  }
}

/** Why a playback run ended / why the state changed. */
export type TimelinePlaybackReason =
  | "end"
  | "user"
  | "device-lost"
  | "error";

export interface TimelinePlaybackState {
  playing: boolean;
  reason?: TimelinePlaybackReason;
  positionMs: number;
  durationMs: number;
  dryRun: boolean;
}

export type TimelineEngineEvents = {
  time: (ms: number) => void;
  state: (state: TimelinePlaybackState) => void;
  log: (text: string) => void;
};

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

/** Minimal clock abstraction so timing logic can be unit-tested. */
export interface TimelineClock {
  /** Monotonic time in nanoseconds (default: `process.hrtime.bigint()`). */
  nowNs(): bigint;
  /** Schedule `cb` after `delayMs`; returns a cancel function. */
  schedule(cb: () => void, delayMs: number): () => void;
}

export const hrtimeClock: TimelineClock = {
  nowNs: () => process.hrtime.bigint(),
  schedule: (cb, ms) => {
    const timer = setTimeout(cb, ms);
    return () => clearTimeout(timer);
  },
};

/** Structural slice of InputHub the engine needs (public contract only). */
export interface TimelineHub {
  applyFrom(source: HubSource, report: PadReport): Promise<void>;
  setSource(source: HubSource): Promise<unknown>;
  forceNeutral(): Promise<void>;
}

/** Structural slice of DeviceService: connectivity + disconnect events (S2). */
export interface TimelineDevice {
  isConnected: boolean;
  onStateChanged(cb: (status: { state: string }) => void): () => void;
}

export interface TimelineEngineOptions {
  hub: TimelineHub;
  device: TimelineDevice;
  /** S9 wiring; when absent amiibo events degrade to a no-op log. */
  changeAmiiboIndex?: (slot: number) => Promise<unknown>;
  /** Sample rate used when `load` receives a Project (03-DATA-MODELS §4.2). */
  defaultHz?: number;
  log?: (text: string) => void;
  clock?: TimelineClock;
}

interface LoopState {
  startWallNs: bigint;
  startPosUs: number;
  /** index of the last frame already applied to the device */
  frameIndex: number;
}

const TIME_THROTTLE_NS = 16_000_000n; // 60fps upper bound for playback:time
const TICK_CAP_MS = 33; // 30fps floor: keep time flowing between sparse frames

/**
 * Main-process high-resolution playback engine (S6).
 *
 * Scheduling scheme A — fixed-hz frame array (work order §3.2):
 *   `compile()` already produces a uniformly-sampled `TimedPadReport[]`, so
 *   playback walks the array by wall-clock (hrtime), applying the newest due
 *   frame on each tick. Simple, O(1) memory beyond the compile output, and the
 *   ReportWriter's newest-wins coalescing means intermediate frames collapse
 *   cleanly instead of queueing. Scheme B (event list + hold-last-frame) would
 *   save memory for very long projects and is a drop-in replacement later.
 */
/**
 * S10：同一毫秒（compile 生成的 tUs = startMs*1000，同一 startMs 即同一 tUs）内的
 * 多个切换事件折叠为最后一个（last-wins）。设备只有一个当前槽位，同毫秒重复
 * ChangeAmiiboIndex 既冗余又有 ACK 时序风险；03-DATA-MODELS §4.1 语义为边沿触发。
 */
function dedupeAmiiboEvents(events: AmiiboEvent[]): AmiiboEvent[] {
  const out: AmiiboEvent[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && last.tUs === ev.tUs) {
      out[out.length - 1] = ev;
    } else {
      out.push(ev);
    }
  }
  return out;
}

export class TimelineEngine extends TypedEmitter<TimelineEngineEvents> {
  private frames: TimedPadReport[] = [];
  private amiiboEvents: AmiiboEvent[] = [];
  private durationUs = 0;
  private loaded = false;

  private playing = false;
  private dryRun = false;
  private positionUs = 0;
  private amiiboIndex = 0;

  private loop: LoopState | null = null;
  private cancelTick: (() => void) | null = null;
  private lastEmitNs = 0n;
  private offDeviceStateChanged: (() => void) | null = null;

  private readonly defaultHz: number;
  private readonly clock: TimelineClock;
  private readonly hub: TimelineHub;
  private readonly device: TimelineDevice;
  private readonly changeAmiiboIndex: ((slot: number) => Promise<unknown>) | null;
  private readonly logText: (text: string) => void;
  private readonly log: (text: string) => void;

  constructor(opts: TimelineEngineOptions) {
    super();
    this.hub = opts.hub;
    this.device = opts.device;
    this.defaultHz = opts.defaultHz ?? 250;
    this.clock = opts.clock ?? hrtimeClock;
    this.changeAmiiboIndex = opts.changeAmiiboIndex ?? null;
    this.logText = opts.log ?? (() => undefined);
    this.log = (text) => {
      this.logText(text);
      this.emit("log", text);
    };

    this.offDeviceStateChanged = this.device.onStateChanged((status) => {
      if (this.playing && status.state !== "connected") {
        this.log("[timeline] 设备断开，停止回放");
        void this.finish("device-lost");
      }
    });
  }

  getState(): TimelinePlaybackState {
    return {
      playing: this.playing,
      positionMs: this.positionMs(),
      durationMs: Math.round(this.durationUs / 1000),
      dryRun: this.dryRun,
    };
  }

  /**
   * Accepts either a validated Project (compiled here at `hz`, default 250)
   * or a precompiled `CompileResult`. Loading while playing stops first.
   */
  load(input: Project | CompileResult, opts: { hz?: number } = {}): TimelineLoadResult {
    if (this.playing) {
      this.log("[timeline] 播放中加载工程：先停止");
      void this.finish("user");
    }

    let frames: TimedPadReport[];
    let amiiboEvents: AmiiboEvent[];
    let durationUs: number;

    if (Array.isArray((input as CompileResult).frames)) {
      const result = input as CompileResult;
      if (result.frames.length === 0) {
        return { ok: false, error: "CompileResult 帧流为空" };
      }
      frames = result.frames;
      amiiboEvents = result.amiiboEvents ?? [];
      durationUs = frames[frames.length - 1]!.tUs;
    } else {
      const hz = opts.hz ?? this.defaultHz;
      let result: CompileResult;
      try {
        result = compile(input as Project, { hz });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      if (result.frames.length === 0) {
        return { ok: false, error: "编译结果帧流为空" };
      }
      frames = result.frames;
      amiiboEvents = result.amiiboEvents;
      durationUs = (input as Project).durationMs * 1000;
    }

    this.frames = frames;
    const sorted = [...amiiboEvents].sort((a, b) => a.tUs - b.tUs);
    const valid: AmiiboEvent[] = [];
    for (const ev of sorted) {
      // S10 薄层：timeline-model 只校验 slot >= 0，engine 在此兜底记日志（0–15）。
      if (!Number.isInteger(ev.slot) || ev.slot < 0 || ev.slot > 15) {
        this.log(`[timeline] 警告：amiibo slot ${ev.slot} 超出 0–15（t=${ev.tUs}us），跳过`);
        continue;
      }
      valid.push(ev);
    }
    this.amiiboEvents = dedupeAmiiboEvents(valid);
    this.durationUs = Math.max(durationUs, frames[frames.length - 1]!.tUs);
    this.loaded = true;
    this.positionUs = 0;
    this.amiiboIndex = 0;
    this.loop = null;
    this.dryRun = false;
    this.lastEmitNs = 0n;
    this.cancelLoop();
    this.emit("time", 0);
    return {
      ok: true,
      durationMs: Math.round(this.durationUs / 1000),
      frameCount: frames.length,
    };
  }

  async play(opts: { dryRun?: boolean } = {}): Promise<TimelinePlayResult> {
    if (!this.loaded || this.frames.length === 0) {
      return { ok: false, playing: false, error: "未加载工程" };
    }
    if (this.playing) {
      return { ok: true, playing: true, dryRun: this.dryRun };
    }

    const dryRun = opts.dryRun ?? false;
    if (!this.device.isConnected && !dryRun) {
      return {
        ok: false,
        playing: false,
        error: "设备未连接（可试播仅移动播放头）",
      };
    }

    this.dryRun = dryRun;
    if (!dryRun) {
      try {
        // Claim the output source; setSource neutralizes first (no stuck keys).
        await this.hub.setSource("timeline");
        // Push the current frame state immediately so a mid-press resume
        // doesn't start from a neutral gap.
        const idx = this.frameIndexAt(this.positionUs);
        if (idx >= 0) this.applyFrame(this.frames[idx]!);
      } catch (err) {
        this.onError(err);
        return { ok: false, playing: false, error: "切换输出源失败" };
      }
    }

    this.playing = true;
    this.startLoop();
    this.emitState();
    return { ok: true, playing: true, dryRun };
  }

  async pause(): Promise<TimelinePlaybackState> {
    if (!this.playing) return this.getState();
    await this.finish("user");
    return this.getState();
  }

  async stop(): Promise<TimelinePlaybackState> {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      await this.finish("user");
    } else if (!this.dryRun) {
      try {
        await this.hub.forceNeutral();
        await this.hub.setSource("idle");
      } catch (err) {
        this.onError(err);
      }
    }
    this.positionUs = 0;
    this.amiiboIndex = 0;
    this.lastEmitNs = 0n;
    this.emit("time", 0);
    return this.getState();
  }

  seek(ms: number): TimelinePlaybackState {
    const us = Math.max(0, Math.round(ms * 1000));
    this.positionUs = us;
    this.amiiboIndex = this.amiiboIndexAt(us);
    if (this.playing && this.loop) {
      const nowNs = this.clock.nowNs();
      this.loop.startWallNs = nowNs;
      this.loop.startPosUs = us;
      this.loop.frameIndex = this.frameIndexAt(us);
      if (!this.dryRun) {
        const idx = this.frameIndexAt(us);
        if (idx >= 0) this.applyFrame(this.frames[idx]!);
      }
      this.scheduleTick(0);
    }
    this.lastEmitNs = 0n;
    this.emit("time", this.positionMs());
    return this.getState();
  }

  dispose(): void {
    this.cancelLoop();
    this.offDeviceStateChanged?.();
    this.offDeviceStateChanged = null;
    if (this.playing) void this.finish("user");
  }

  // ------------------------------------------------------------------
  // Loop internals
  // ------------------------------------------------------------------

  private startLoop(): void {
    this.cancelLoop();
    const posUs = this.positionUs;
    this.loop = {
      startWallNs: this.clock.nowNs(),
      startPosUs: posUs,
      frameIndex: this.frameIndexAt(posUs),
    };
    this.lastEmitNs = 0n;
    this.emit("time", this.positionMs());
    this.scheduleTick(0);
  }

  private tick(): void {
    if (!this.playing || !this.loop) return;
    const nowNs = this.clock.nowNs();
    const elapsedUs = Number(nowNs - this.loop.startWallNs) / 1000;
    const targetUs = this.loop.startPosUs + elapsedUs;

    if (targetUs >= this.durationUs) {
      const last = this.frames.length - 1;
      if (last >= 0 && this.loop.frameIndex < last) {
        this.applyFrame(this.frames[last]!);
        this.loop.frameIndex = last;
      }
      this.positionUs = this.durationUs;
      void this.finish("end");
      return;
    }

    this.positionUs = targetUs;
    const idx = this.frameIndexAt(targetUs);
    if (idx > this.loop.frameIndex) {
      // ReportWriter coalesces newest-wins; applying only the latest due frame
      // is equivalent to replaying the whole burst and avoids queue growth.
      this.applyFrame(this.frames[idx]!);
      this.loop.frameIndex = idx;
    }

    this.fireAmiiboFor(targetUs);
    this.emitTime(nowNs);
    this.scheduleNextTick(targetUs);
  }

  private scheduleNextTick(targetUs: number): void {
    if (!this.loop || !this.playing) return;
    const next = this.frames[this.loop.frameIndex + 1];
    const nextDueUs = next ? next.tUs : this.durationUs;
    const delayMs = (nextDueUs - targetUs) / 1000;
    // 30–60fps floor: never sleep longer than ~33ms so playback:time keeps
    // flowing even between sparse frames; never tighter than ~1ms.
    const clamped = Math.min(Math.max(delayMs, 1), TICK_CAP_MS);
    this.cancelTick = this.clock.schedule(() => this.tick(), clamped);
  }

  private scheduleTick(delayMs: number): void {
    this.cancelLoop();
    this.cancelTick = this.clock.schedule(() => this.tick(), Math.max(0, delayMs));
  }

  private cancelLoop(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private async finish(reason: TimelinePlaybackReason): Promise<void> {
    if (!this.playing) return;
    this.cancelLoop();
    this.playing = false;
    this.loop = null;
    if (!this.dryRun) {
      try {
        // 收尾策略：中立 + 释放输出源。setSource("idle") 内部已先发中立，
        // 再显式 forceNeutral 双保险，防止回放中停在任何按键/摇杆状态。
        await this.hub.forceNeutral();
        await this.hub.setSource("idle");
      } catch (err) {
        this.onError(err);
      }
    }
    this.lastEmitNs = 0n;
    this.emit("time", this.positionMs());
    this.emitState(reason);
  }

  private applyFrame(frame: TimedPadReport): void {
    if (this.dryRun) return; // dry-run only moves the playhead
    const report: PadReport = {
      buttons: frame.buttons,
      hat: frame.hat,
      lx: frame.lx,
      ly: frame.ly,
      rx: frame.rx,
      ry: frame.ry,
    };
    void this.hub.applyFrom("timeline", report).catch((err) => this.onError(err));
  }

  private fireAmiiboFor(us: number): void {
    const events = this.amiiboEvents;
    while (this.amiiboIndex < events.length && events[this.amiiboIndex]!.tUs <= us) {
      const ev = events[this.amiiboIndex]!;
      this.amiiboIndex++;
      if (this.dryRun) continue;
      if (!this.changeAmiiboIndex) {
        this.log(
          `[timeline] amiibo 事件未接线 (S9)：slot ${ev.slot} @ ${ev.tUs}us 跳过`,
        );
        continue;
      }
      void this.changeAmiiboIndex(ev.slot).catch((err) =>
        this.log(
          `[timeline] changeAmiiboIndex(${ev.slot}) 失败: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }

  private emitTime(nowNs: bigint): void {
    if (nowNs - this.lastEmitNs < TIME_THROTTLE_NS) return;
    this.lastEmitNs = nowNs;
    this.emit("time", this.positionMs());
  }

  private emitState(reason?: TimelinePlaybackReason): void {
    const state = this.getState();
    if (reason) state.reason = reason;
    this.emit("state", state);
  }

  private onError(err: unknown): void {
    const text = err instanceof Error ? err.message : String(err);
    this.log(`[timeline] ${text}`);
  }

  private positionMs(): number {
    return Math.round(this.positionUs / 1000);
  }

  /** Index of the last frame with tUs <= us; -1 when us precedes frame 0. */
  private frameIndexAt(us: number): number {
    const frames = this.frames;
    if (frames.length === 0 || us < frames[0]!.tUs) return -1;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid]!.tUs <= us) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Number of amiibo events with tUs <= us (the cursor position). */
  private amiiboIndexAt(us: number): number {
    let i = 0;
    const events = this.amiiboEvents;
    while (i < events.length && events[i]!.tUs <= us) i++;
    return i;
  }
}
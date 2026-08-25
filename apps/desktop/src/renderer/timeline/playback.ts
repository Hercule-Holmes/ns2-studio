import { reactive } from "vue";
import { timelineStore } from "./store";

export const PLAYBACK_HZ = 250;

export type TransportState = "stopped" | "playing" | "paused";

export interface PlaybackState {
  transport: TransportState;
  positionMs: number;
  durationMs: number;
  dryRun: boolean;
  deviceLost: boolean;
}

export interface PlaybackResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
}

/**
 * Renderer-side playback controller (S6). Thin façade over `window.api.timeline`:
 * holds transport state for the UI, feeds `playback:time` into the editor
 * playhead, and maps engine state events (end / device-lost / user) to
 * transport transitions. `timelineStore.editor.playheadMs` keeps its "last
 * known position" semantics (INTEGRATION.md §S5): while playing it is driven by
 * `playback:time`.
 */
export function createPlaybackController(): {
  state: PlaybackState;
  load(): Promise<PlaybackResult>;
  play(): Promise<PlaybackResult>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(ms: number): Promise<void>;
  retryDryRun(): Promise<PlaybackResult>;
  dispose(): void;
} {
  const state = reactive<PlaybackState>({
    transport: "stopped",
    positionMs: 0,
    durationMs: 0,
    dryRun: false,
    deviceLost: false,
  });

  let loaded = false;
  const offTime = window.api.timeline.onTime((ms) => {
    state.positionMs = ms;
    timelineStore.setPlayhead(ms);
  });
  const offState = window.api.timeline.onState((s) => {
    state.positionMs = s.positionMs;
    state.durationMs = s.durationMs;
    state.dryRun = s.dryRun;
    if (s.playing) {
      state.transport = "playing";
      state.deviceLost = false;
    } else if (s.reason === "device-lost") {
      state.transport = "stopped";
      state.deviceLost = true;
    } else if (s.reason === "end") {
      state.transport = "stopped";
    }
    // reason === "user" keeps the transport the caller already set.
    timelineStore.setPlayhead(s.positionMs);
  });

  async function load(): Promise<PlaybackResult> {
    const res = await window.api.timeline.load(timelineStore.project, {
      hz: PLAYBACK_HZ,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "加载失败" };
    loaded = true;
    return { ok: true };
  }

  async function play(): Promise<PlaybackResult> {
    const err = timelineStore.validate();
    if (err) return { ok: false, error: `工程校验失败：${err}` };
    const loadRes = await load();
    if (!loadRes.ok) return loadRes;
    const res = await window.api.timeline.play();
    if (!res.ok) return { ok: false, error: res.error };
    state.transport = "playing";
    state.dryRun = !!res.dryRun;
    return { ok: true, dryRun: state.dryRun };
  }

  async function retryDryRun(): Promise<PlaybackResult> {
    const res = await window.api.timeline.play({ dryRun: true });
    if (!res.ok) return { ok: false, error: res.error ?? "试播失败" };
    state.transport = "playing";
    state.dryRun = true;
    return { ok: true, dryRun: true };
  }

  async function pause(): Promise<void> {
    const s = await window.api.timeline.pause();
    state.transport = "paused";
    state.positionMs = s.positionMs;
  }

  async function stop(): Promise<void> {
    const s = await window.api.timeline.stop();
    state.transport = "stopped";
    state.positionMs = s.positionMs;
    state.deviceLost = false;
  }

  async function seek(ms: number): Promise<void> {
    timelineStore.setPlayhead(ms);
    if (!loaded) return;
    const s = await window.api.timeline.seek(ms);
    state.positionMs = s.positionMs;
  }

  function dispose(): void {
    offTime();
    offState();
  }

  return { state, load, play, pause, stop, seek, retryDryRun, dispose };
}

export const playback = createPlaybackController();
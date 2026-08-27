/**
 * S7 nsrec 回放 — reuses S6 TimelineEngine's frame playback path. The engine's
 * `load` accepts a CompileResult, and a Recording's frames are already
 * TimedPadReport[], so loading `{ frames, amiiboEvents: [] }` replays a
 * recording on the hub's "timeline" source with hold-last-frame + auto
 * forceNeutral on end. Fallback note: if S6 is absent this would need a simple
 * frame timer instead.
 */
import { reactive } from "vue";
import type { Recording } from "@ns2-studio/timeline-model";
import type { TimelinePlaybackState } from "../../shared/ipc";

export interface ReplayState {
  playing: boolean;
}

export interface ReplayHandle {
  state: ReplayState;
  start(rec: Recording): Promise<void>;
  stop(): void;
}

export function useReplay(): ReplayHandle {
  const state = reactive<ReplayState>({ playing: false });
  let offState: (() => void) | null = null;

  function onState(s: TimelinePlaybackState): void {
    state.playing = s.playing;
  }

  async function start(rec: Recording): Promise<void> {
    stop();
    if (rec.frames.length === 0) return;
    // `rec` may be a Vue ref()'d object (deep-reactive proxies). Electron IPC
    // cannot structured-clone proxies ("An object could not be cloned"), so
    // send a plain JSON copy.
    const loadRes = await window.api.timeline.load(
      JSON.parse(
        JSON.stringify({ frames: rec.frames, amiiboEvents: [] }),
      ) as { frames: Array<Record<string, unknown>>; amiiboEvents: unknown[] },
    );
    if (!loadRes.ok) {
      throw new Error(loadRes.error ?? "加载录制到回放引擎失败");
    }
    offState = window.api.timeline.onState(onState);
    const playRes = await window.api.timeline.play();
    if (!playRes.ok) {
      offState();
      offState = null;
      throw new Error(playRes.error ?? "回放失败");
    }
    state.playing = true;
  }

  function stop(): void {
    if (offState) void window.api.timeline.stop();
    offState?.();
    offState = null;
    state.playing = false;
  }

  return { state, start, stop };
}
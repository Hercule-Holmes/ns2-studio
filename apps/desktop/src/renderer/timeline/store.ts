import { reactive } from "vue";
import { nameToButton } from "@ns2-studio/pad-types";
import {
  createEmptyProject,
  migrate,
  validateProject,
  type AmiiboClip,
  type ButtonClip,
  type HatClip,
  type MarkerClip,
  type Project,
  type StickClip,
  type StickKeyframe,
  type StickName,
  type Track,
  type TrackType,
} from "@ns2-studio/timeline-model";

export const MIN_ZOOM = 5; // px per second
export const MAX_ZOOM = 400;
export const DEFAULT_ZOOM = 40;
export const DEFAULT_CONTENT_MS = 10_000;
const HISTORY_LIMIT = 100;

export interface TrackDef {
  key: string;
  title: string;
  type: TrackType;
  stick?: StickName;
  readonly?: boolean;
}

/** Fixed track lane order; missing project tracks render as empty placeholders. */
export const TRACK_DEFS: TrackDef[] = [
  { key: "buttons", title: "按键", type: "buttons" },
  { key: "stickL", title: "左摇杆", type: "stick", stick: "L" },
  { key: "stickR", title: "右摇杆", type: "stick", stick: "R" },
  { key: "hat", title: "十字键", type: "hat" },
  { key: "marker", title: "标记", type: "marker" },
  // S10：S5 的 amiibo 灰轨占位在此启用为可编辑轨。
  { key: "amiibo", title: "Amiibo", type: "amiibo" },
];

/** Amiibo 槽位范围（03-DATA-MODELS §4.1；timeline-model 仅校验 >= 0，见 S10）。 */
export const MAX_AMIIBO_SLOT = 15;

export type AnyClip = ButtonClip | StickClip | HatClip | AmiiboClip | MarkerClip;

export interface EditorState {
  playheadMs: number;
  /** px per second */
  zoom: number;
  /** left edge visible time (ms) */
  scrollMs: number;
  loopInMs: number | null;
  loopOutMs: number | null;
}

interface CopyGroup {
  defKey: string;
  clips: AnyClip[];
}

export interface TimelineStore {
  project: Project;
  editor: EditorState;
  selectedIds: string[];
  filePath: string | null;
  dirty: boolean;
  validationError: string | null;
  statusText: string;
  undoDepth: number;
  redoDepth: number;

  // file / lifecycle
  newProject(name?: string): void;
  openFromContent(content: string, path: string | null): void;
  serialize(): string;
  markSaved(path: string | null): void;
  validate(): string | null;

  // project-level
  updateProjectField(field: "name" | "durationMs" | "gridMs", value: number | string): boolean;

  // tracks / clips
  defForKey(key: string): TrackDef | undefined;
  trackForDef(def: TrackDef): Track | null;
  addClip(defKey: string): void;
  removeSelected(): void;
  moveClip(trackId: string, clipId: string, startMs: number, endMs: number): void;
  resizeClipEnd(trackId: string, clipId: string, endMs: number): void;
  updateClipField(
    trackId: string,
    clipId: string,
    field: "startMs" | "endMs" | "key" | "hat" | "label" | "slot",
    value: number | string,
  ): boolean;
  updateStickKeyframe(
    trackId: string,
    clipId: string,
    index: number,
    patch: Partial<StickKeyframe>,
  ): boolean;
  addStickKeyframe(trackId: string, clipId: string): void;
  removeStickKeyframe(trackId: string, clipId: string, index: number): void;

  // selection
  selectedClips(): { track: Track; clip: AnyClip }[];
  lastSelectedClip(): { track: Track; clip: AnyClip } | null;
  selectOnly(clipId: string): void;
  toggleSelect(clipId: string): void;
  clearSelection(): void;

  // clipboard / history
  copySelected(): void;
  paste(): void;
  beginTransaction(): void;
  commitTransaction(): void;
  cancelTransaction(): void;
  undo(): void;
  redo(): void;

  // transport / view
  setPlayhead(ms: number): void;
  zoomAt(anchorPx: number, factor: number): void;
  setScrollMs(ms: number): void;
  setLoopIn(): void;
  setLoopOut(): void;
  clearLoop(): void;
  contentEndMs(): number;
  snapTime(ms: number): number;
}

function uid(): string {
  return crypto.randomUUID();
}

function cloneProject(p: Project): Project {
  return JSON.parse(JSON.stringify(p)) as Project;
}

function sameProject(a: Project, b: Project): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function makeTrack(def: TrackDef): Track {
  if (def.type === "buttons") {
    return { id: `track_${def.key}`, type: "buttons", clips: [] };
  }
  if (def.type === "stick") {
    return { id: `track_${def.key}`, type: "stick", stick: def.stick ?? "L", clips: [] };
  }
  if (def.type === "hat") {
    return { id: `track_${def.key}`, type: "hat", clips: [] };
  }
  if (def.type === "marker") {
    return { id: `track_${def.key}`, type: "marker", clips: [] };
  }
  return { id: `track_${def.key}`, type: "amiibo", clips: [] };
}

function seedProject(name: string): Project {
  const p = createEmptyProject(name);
  p.durationMs = DEFAULT_CONTENT_MS;
  // Amiibo 轨按需创建（编辑器保留灰轨占位；S10 不改默认工程形态）。
  p.tracks = TRACK_DEFS.filter((d) => d.key !== "amiibo").map(makeTrack);
  return p;
}

export function createTimelineStore(): TimelineStore {
  const state = reactive({
    project: seedProject("未命名工程"),
    editor: {
      playheadMs: 0,
      zoom: DEFAULT_ZOOM,
      scrollMs: 0,
      loopInMs: null as number | null,
      loopOutMs: null as number | null,
    },
    selectedIds: [] as string[],
    filePath: null as string | null,
    dirty: false,
    validationError: null as string | null,
    statusText: "",
    undoDepth: 0,
    redoDepth: 0,
  });

  const undoStack: Project[] = [];
  const redoStack: Project[] = [];
  let pendingBefore: Project | null = null;
  let copied: CopyGroup[] | null = null;

  const defForKey = (key: string): TrackDef | undefined =>
    TRACK_DEFS.find((d) => d.key === key);

  const trackForDef = (def: TrackDef): Track | null => {
    const t = state.project.tracks.find((tr) => {
      if (tr.type !== def.type) return false;
      if (tr.type === "stick" && tr.stick !== def.stick) return false;
      return true;
    });
    return t ?? null;
  };

  const ensureTrack = (def: TrackDef): Track | null => {
    if (def.readonly) return null;
    const existing = trackForDef(def);
    if (existing) return existing;
    const track = makeTrack(def);
    state.project.tracks.push(track);
    return track;
  };

  const snapTime = (ms: number): number =>
    Math.round(ms / state.project.gridMs) * state.project.gridMs;

  const contentEndMs = (): number => {
    let maxClipEnd = state.project.durationMs;
    for (const t of state.project.tracks) {
      for (const c of t.clips) {
        maxClipEnd = Math.max(maxClipEnd, c.endMs);
      }
    }
    return Math.max(DEFAULT_CONTENT_MS, maxClipEnd + 2000);
  };

  const findClip = (clipId: string): { track: Track; clip: AnyClip } | null => {
    for (const t of state.project.tracks) {
      const c = t.clips.find((cl) => cl.id === clipId);
      if (c) return { track: t, clip: c as AnyClip };
    }
    return null;
  };

  const pushUndo = (snapshot: Project): void => {
    undoStack.push(snapshot);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    state.undoDepth = undoStack.length;
    state.redoDepth = 0;
  };

  const clearHistory = (): void => {
    undoStack.length = 0;
    redoStack.length = 0;
    state.undoDepth = 0;
    state.redoDepth = 0;
    pendingBefore = null;
  };

  const runValidate = (): string | null => {
    try {
      validateProject(state.project);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.validationError = message;
      return message;
    }
    // S10 薄层：timeline-model 的 validateAmiiboClip 只校验 slot >= 0，此处补 0–15
    //（03-DATA-MODELS §4.1：amiibo clip 的 slot 在 startMs 触发 ChangeAmiiboIndex）。
    const bad = outOfRangeAmiiboSlots(state.project);
    if (bad.length > 0) {
      const message = `Amiibo 槽位必须为 0–${MAX_AMIIBO_SLOT}：${bad
        .map((b) => `clip ${b.id} slot=${b.slot}`)
        .join("；")}`;
      state.validationError = message;
      console.warn(`[timeline] ${message}`);
      return message;
    }
    state.validationError = null;
    return null;
  };

  const applyEdit = (fn: () => void): void => {
    beginTransactionInner();
    fn();
    commitTransactionInner();
  };

  const beginTransactionInner = (): void => {
    if (pendingBefore === null) {
      pendingBefore = cloneProject(state.project);
    }
  };

  const commitTransactionInner = (): void => {
    if (pendingBefore === null) return;
    if (!sameProject(pendingBefore, state.project)) {
      pushUndo(pendingBefore);
      state.dirty = true;
    }
    pendingBefore = null;
    runValidate();
  };

  const cancelTransactionInner = (): void => {
    if (pendingBefore !== null) {
      state.project = pendingBefore;
      pendingBefore = null;
    }
  };

  const resetEditor = (): void => {
    state.editor.playheadMs = 0;
    state.editor.zoom = DEFAULT_ZOOM;
    state.editor.scrollMs = 0;
    state.editor.loopInMs = null;
    state.editor.loopOutMs = null;
    state.selectedIds = [];
    state.validationError = null;
    state.statusText = "";
  };

  const store: TimelineStore = {
    get project() {
      return state.project;
    },
    get editor() {
      return state.editor;
    },
    get selectedIds() {
      return state.selectedIds;
    },
    get filePath() {
      return state.filePath;
    },
    get dirty() {
      return state.dirty;
    },
    get validationError() {
      return state.validationError;
    },
    get statusText() {
      return state.statusText;
    },
    get undoDepth() {
      return state.undoDepth;
    },
    get redoDepth() {
      return state.redoDepth;
    },

    defForKey,
    trackForDef,
    snapTime,
    contentEndMs,

    newProject(name = "未命名工程") {
      state.project = seedProject(name);
      state.filePath = null;
      state.dirty = false;
      clearHistory();
      resetEditor();
    },

    openFromContent(content, path) {
      const parsed: unknown = JSON.parse(content);
      const migrated = migrate(parsed);
      state.project = migrated;
      state.filePath = path;
      state.dirty = false;
      clearHistory();
      resetEditor();
      runValidate();
    },

    serialize() {
      return JSON.stringify(state.project, null, 2);
    },

    markSaved(path) {
      state.filePath = path;
      state.dirty = false;
      state.statusText = path ? `已保存：${path}` : "已保存";
    },

    validate() {
      return runValidate();
    },

    updateProjectField(field, value) {
      if (field === "name") {
        const s = String(value);
        if (s.trim() === "") {
          state.validationError = "工程名称不能为空";
          return false;
        }
        applyEdit(() => {
          state.project.name = s;
        });
        return true;
      }
      const n = Math.round(Number(value));
      if (!Number.isFinite(n) || n < 0) {
        state.validationError = `${field === "durationMs" ? "时长" : "网格"}必须是非负数字`;
        return false;
      }
      if (field === "gridMs" && n < 1) {
        state.validationError = "网格 (gridMs) 必须为正";
        return false;
      }
      applyEdit(() => {
        if (field === "durationMs") state.project.durationMs = n;
        else state.project.gridMs = n;
      });
      return true;
    },

    addClip(defKey) {
      const def = defForKey(defKey);
      if (!def || def.readonly) return;
      const track = ensureTrack(def);
      if (!track) return;
      const playhead = snapTime(state.editor.playheadMs);
      let clip: AnyClip | null = null;
      if (def.type === "buttons") {
        clip = { id: uid(), key: "A", startMs: playhead, endMs: playhead + 200 };
      } else if (def.type === "stick") {
        clip = {
          id: uid(),
          startMs: playhead,
          endMs: playhead + 200,
          keyframes: [
            { offsetMs: 0, x: 128, y: 128 },
            { offsetMs: 200, x: 128, y: 0 },
          ],
        };
      } else if (def.type === "hat") {
        clip = { id: uid(), startMs: playhead, endMs: playhead + 100, hat: 8 };
      } else if (def.type === "amiibo") {
        // S10：边沿事件 clip。startMs 触发切换，endMs 仅用于可见宽度（compile 只看 startMs）。
        clip = { id: uid(), startMs: playhead, endMs: playhead + 100, slot: 0 };
      } else if (def.type === "marker") {
        clip = { id: uid(), startMs: playhead, endMs: playhead, label: "标记" };
      }
      if (!clip) return;
      applyEdit(() => {
        track.clips.push(clip as never);
        state.selectedIds = [clip!.id];
      });
    },

    removeSelected() {
      const ids = [...state.selectedIds];
      if (ids.length === 0) return;
      applyEdit(() => {
        for (const t of state.project.tracks) {
          if (t.clips.length === 0) continue;
          const next = t.clips.filter((c) => !ids.includes(c.id));
          if (next.length !== t.clips.length) {
            (t.clips as AnyClip[]).splice(0, t.clips.length, ...next);
          }
        }
        state.selectedIds = [];
      });
    },

    moveClip(trackId, clipId, startMs, endMs) {
      const found = findClip(clipId);
      if (!found || found.track.id !== trackId) return;
      const start = clamp(Math.round(startMs), 0, Number.MAX_SAFE_INTEGER);
      const end = Math.max(start + 1, Math.round(endMs));
      found.clip.startMs = start;
      found.clip.endMs = end;
    },

    resizeClipEnd(trackId, clipId, endMs) {
      const found = findClip(clipId);
      if (!found || found.track.id !== trackId) return;
      found.clip.endMs = Math.max(found.clip.startMs + 1, Math.round(endMs));
    },

    updateClipField(trackId, clipId, field, value) {
      const found = findClip(clipId);
      if (!found || found.track.id !== trackId) return false;

      if (field === "startMs" || field === "endMs") {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n) || n < 0) {
          state.validationError = "时间必须是非负数字";
          return false;
        }
        if (field === "startMs" && n > found.clip.endMs) {
          state.validationError = "开始时间不能晚于结束时间";
          return false;
        }
        if (field === "endMs" && n < found.clip.startMs) {
          state.validationError = "结束时间不能早于开始时间 (end < start)";
          return false;
        }
        applyEdit(() => {
          if (field === "startMs") found.clip.startMs = n;
          else found.clip.endMs = n;
        });
        return true;
      }

      if (found.track.type === "buttons" && field === "key") {
        const key = String(value).toUpperCase();
        try {
          nameToButton(key);
        } catch {
          state.validationError = `未知按键 "${key}"`;
          return false;
        }
        applyEdit(() => {
          (found.clip as ButtonClip).key = key;
        });
        return true;
      }

      if (found.track.type === "hat" && field === "hat") {
        const n = Math.round(Number(value));
        if (!Number.isInteger(n) || n < 0 || n > 8) {
          state.validationError = "十字键值必须是 0–8 的整数";
          return false;
        }
        applyEdit(() => {
          (found.clip as HatClip).hat = n;
        });
        return true;
      }

      if (found.track.type === "marker" && field === "label") {
        const s = String(value);
        if (s.trim() === "") {
          state.validationError = "标记标签不能为空";
          return false;
        }
        applyEdit(() => {
          (found.clip as MarkerClip).label = s;
        });
        return true;
      }

      if (found.track.type === "amiibo" && field === "slot") {
        const n = Math.round(Number(value));
        if (!Number.isInteger(n) || n < 0 || n > MAX_AMIIBO_SLOT) {
          state.validationError = `槽位必须是 0–${MAX_AMIIBO_SLOT} 的整数`;
          return false;
        }
        applyEdit(() => {
          (found.clip as AmiiboClip).slot = n;
        });
        return true;
      }

      return false;
    },

    updateStickKeyframe(trackId, clipId, index, patch) {
      const found = findClip(clipId);
      if (!found || found.track.id !== trackId || found.track.type !== "stick") {
        return false;
      }
      const clip = found.clip as StickClip;
      const kf = clip.keyframes[index];
      if (!kf) return false;
      const next = clip.keyframes.map((k, i) =>
        i === index ? { ...k, ...patch } : { ...k },
      );
      for (let i = 0; i < next.length; i++) {
        const item = next[i]!;
        if (
          !Number.isFinite(item.offsetMs) ||
          !Number.isFinite(item.x) ||
          !Number.isFinite(item.y) ||
          item.offsetMs < 0 ||
          item.x < 0 ||
          item.y < 0 ||
          item.x > 255 ||
          item.y > 255
        ) {
          state.validationError = "关键帧超出范围 (offset≥0, x/y 0–255)";
          return false;
        }
        if (i > 0 && item.offsetMs <= next[i - 1]!.offsetMs) {
          state.validationError = "关键帧 offset 必须严格递增";
          return false;
        }
      }
      applyEdit(() => {
        clip.keyframes = next;
      });
      return true;
    },

    addStickKeyframe(trackId, clipId) {
      const found = findClip(clipId);
      if (!found || found.track.type !== "stick") return;
      const clip = found.clip as StickClip;
      const last = clip.keyframes[clip.keyframes.length - 1];
      const offset = last ? last.offsetMs + 100 : 0;
      const end = clip.endMs - clip.startMs;
      applyEdit(() => {
        clip.keyframes.push({ offsetMs: Math.min(offset, end), x: 128, y: 128 });
      });
    },

    removeStickKeyframe(trackId, clipId, index) {
      const found = findClip(clipId);
      if (!found || found.track.type !== "stick") return;
      const clip = found.clip as StickClip;
      if (clip.keyframes.length <= 1) return;
      applyEdit(() => {
        clip.keyframes.splice(index, 1);
      });
    },

    selectedClips() {
      return state.selectedIds
        .map((id) => findClip(id))
        .filter((f): f is { track: Track; clip: AnyClip } => f !== null);
    },

    lastSelectedClip() {
      const id = state.selectedIds[state.selectedIds.length - 1];
      return id ? findClip(id) : null;
    },

    selectOnly(clipId) {
      state.selectedIds = [clipId];
    },

    toggleSelect(clipId) {
      const idx = state.selectedIds.indexOf(clipId);
      if (idx >= 0) state.selectedIds.splice(idx, 1);
      else state.selectedIds.push(clipId);
    },

    clearSelection() {
      state.selectedIds = [];
    },

    copySelected() {
      const byDef = new Map<string, AnyClip[]>();
      for (const { track, clip } of store.selectedClips()) {
        const def = TRACK_DEFS.find((d) => {
          if (d.type !== track.type) return false;
          if (track.type === "stick" && d.stick !== (track as { stick: StickName }).stick) {
            return false;
          }
          return true;
        });
        if (!def) continue;
        const list = byDef.get(def.key) ?? [];
        list.push(cloneClip(clip));
        byDef.set(def.key, list);
      }
      copied = [...byDef.entries()].map(([defKey, clips]) => ({ defKey, clips }));
    },

    paste() {
      if (!copied || copied.length === 0) return;
      const groups = copied;
      const target = snapTime(state.editor.playheadMs);
      const pastedIds: string[] = [];
      applyEdit(() => {
        for (const group of groups) {
          const def = defForKey(group.defKey);
          if (!def || def.readonly) continue;
          const track = ensureTrack(def);
          if (!track) continue;
          const minStart = Math.min(...group.clips.map((c) => c.startMs));
          const delta = target - minStart;
          for (const src of group.clips) {
            const clip = cloneClip(src);
            clip.id = uid();
            clip.startMs = Math.max(0, snapTime(src.startMs + delta));
            clip.endMs = Math.max(clip.startMs + 1, snapTime(src.endMs + delta));
            (track.clips as AnyClip[]).push(clip);
            pastedIds.push(clip.id);
          }
        }
        state.selectedIds = pastedIds;
      });
    },

    beginTransaction: beginTransactionInner,

    commitTransaction: commitTransactionInner,

    cancelTransaction: cancelTransactionInner,

    undo() {
      const snapshot = undoStack.pop();
      if (!snapshot) return;
      redoStack.push(cloneProject(state.project));
      state.project = snapshot;
      state.dirty = true;
      state.undoDepth = undoStack.length;
      state.redoDepth = redoStack.length;
      state.selectedIds = [];
      runValidate();
    },

    redo() {
      const snapshot = redoStack.pop();
      if (!snapshot) return;
      undoStack.push(cloneProject(state.project));
      state.project = snapshot;
      state.dirty = true;
      state.undoDepth = undoStack.length;
      state.redoDepth = redoStack.length;
      state.selectedIds = [];
      runValidate();
    },

    setPlayhead(ms) {
      state.editor.playheadMs = clamp(ms, 0, contentEndMs());
    },

    zoomAt(anchorPx, factor) {
      const oldZoom = state.editor.zoom;
      const newZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === oldZoom) return;
      const anchorTime = state.editor.scrollMs + (anchorPx / oldZoom) * 1000;
      state.editor.zoom = newZoom;
      state.editor.scrollMs = Math.max(0, anchorTime - (anchorPx / newZoom) * 1000);
    },

    setScrollMs(ms) {
      state.editor.scrollMs = Math.max(0, ms);
    },

    setLoopIn() {
      state.editor.loopInMs = state.editor.playheadMs;
    },

    setLoopOut() {
      state.editor.loopOutMs = state.editor.playheadMs;
    },

    clearLoop() {
      state.editor.loopInMs = null;
      state.editor.loopOutMs = null;
    },
  };

  return store;
}

function cloneClip(c: AnyClip): AnyClip {
  return JSON.parse(JSON.stringify(c)) as AnyClip;
}

/** S10 薄层校验：返回 slot 越界（非 0–15）的 amiibo clips。timeline-model 不校验上限。 */
export function outOfRangeAmiiboSlots(
  project: Project,
): { id: string; slot: number }[] {
  const bad: { id: string; slot: number }[] = [];
  for (const t of project.tracks) {
    if (t.type !== "amiibo") continue;
    for (const c of t.clips) {
      if (!Number.isInteger(c.slot) || c.slot < 0 || c.slot > MAX_AMIIBO_SLOT) {
        bad.push({ id: c.id, slot: c.slot });
      }
    }
  }
  return bad;
}

export const timelineStore: TimelineStore = createTimelineStore();
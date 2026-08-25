<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { msToPx, pxToMs } from "../format";
import { timelineStore, TRACK_DEFS } from "../store";
import { playback } from "../playback";
import TimelineRuler from "./TimelineRuler.vue";
import TrackRow from "./TrackRow.vue";

const ROW_HEIGHT = 44;

const store = timelineStore;

const scrollEl = ref<HTMLElement | null>(null);
const viewportWidth = ref(600);
const playheadDrag = ref(false);
let observer: ResizeObserver | null = null;

const contentWidth = computed(() => msToPx(store.contentEndMs(), store.editor.zoom));

const loop = computed(() => {
  const a = store.editor.loopInMs;
  const b = store.editor.loopOutMs;
  if (a === null && b === null) return null;
  const from = Math.min(a ?? b ?? 0, b ?? a ?? 0);
  const to = Math.max(a ?? b ?? 0, b ?? a ?? 0);
  return { from, to };
});

function updateViewport(): void {
  if (scrollEl.value) viewportWidth.value = scrollEl.value.clientWidth;
}

function onScroll(): void {
  if (!scrollEl.value) return;
  store.setScrollMs(pxToMs(scrollEl.value.scrollLeft, store.editor.zoom));
}

watch(
  () => store.editor.scrollMs,
  (ms) => {
    if (!scrollEl.value) return;
    const target = msToPx(ms, store.editor.zoom);
    if (Math.abs(scrollEl.value.scrollLeft - target) > 0.5) {
      scrollEl.value.scrollLeft = target;
    }
  },
);

function onWheel(e: WheelEvent): void {
  if (!scrollEl.value) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = scrollEl.value.getBoundingClientRect();
    const anchorPx = scrollEl.value.scrollLeft + (e.clientX - rect.left);
    store.zoomAt(anchorPx, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    return;
  }
  e.preventDefault();
  scrollEl.value.scrollLeft += e.deltaY;
}

function setPlayheadFromClientX(clientX: number): void {
  if (!scrollEl.value) return;
  const rect = scrollEl.value.getBoundingClientRect();
  const x = clientX - rect.left + scrollEl.value.scrollLeft;
  const ms = pxToMs(x, store.editor.zoom);
  store.setPlayhead(ms);
  // 拖动 seek 走 timeline:seek(ms)（S6；engine 未加载时仅更新本地播放头）
  void playback.seek(ms);
}

function beginPlayheadDrag(e: PointerEvent): void {
  playheadDrag.value = true;
  scrollEl.value?.setPointerCapture(e.pointerId);
  setPlayheadFromClientX(e.clientX);
}

function onRulerDown(e: PointerEvent): void {
  beginPlayheadDrag(e);
}

function onPlayheadHandleDown(e: PointerEvent): void {
  e.stopPropagation();
  beginPlayheadDrag(e);
}

function onRowBackgroundDown(e: PointerEvent): void {
  beginPlayheadDrag(e);
}

function onEmptyDown(e: PointerEvent): void {
  store.clearSelection();
  beginPlayheadDrag(e);
}

function onBodyMove(e: PointerEvent): void {
  if (playheadDrag.value) setPlayheadFromClientX(e.clientX);
}

function onBodyUp(): void {
  playheadDrag.value = false;
}

onMounted(() => {
  updateViewport();
  observer = new ResizeObserver(() => updateViewport());
  if (scrollEl.value) observer.observe(scrollEl.value);
  window.addEventListener("resize", updateViewport);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", updateViewport);
});
</script>

<template>
  <div class="tl-editor">
    <div class="tl-headers">
      <div class="header-spacer">时间</div>
      <div
        v-for="def in TRACK_DEFS"
        :key="def.key"
        class="header-cell"
        :style="{ height: ROW_HEIGHT + 'px' }"
      >
        <span class="header-title">{{ def.title }}</span>
        <button
          v-if="!def.readonly"
          class="header-add"
          title="在播放头处添加片段"
          @click="store.addClip(def.key)"
        >
          ＋
        </button>
      </div>
      <div class="header-fill"></div>
    </div>

    <div
      ref="scrollEl"
      class="tl-scroll"
      @scroll="onScroll"
      @wheel="onWheel"
      @pointermove="onBodyMove"
      @pointerup="onBodyUp"
      @pointercancel="onBodyUp"
    >
      <div class="tl-canvas" :style="{ width: contentWidth + 'px' }">
        <TimelineRuler
          :viewport-width="viewportWidth"
          :content-width="contentWidth"
          @pointerdown="onRulerDown"
        />
        <TrackRow
          v-for="def in TRACK_DEFS"
          :key="def.key"
          :def="def"
          :row-height="ROW_HEIGHT"
          @background-down="onRowBackgroundDown"
        />
        <div class="tl-empty" @pointerdown="onEmptyDown"></div>

        <div
          v-if="loop"
          class="tl-loop"
          :style="{
            left: msToPx(loop.from, store.editor.zoom) + 'px',
            width: Math.max(0, msToPx(loop.to - loop.from, store.editor.zoom)) + 'px',
          }"
        ></div>

        <div
          class="tl-playhead"
          :style="{ left: msToPx(store.editor.playheadMs, store.editor.zoom) + 'px' }"
        >
          <div class="playhead-handle" @pointerdown.stop="onPlayheadHandleDown"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tl-editor {
  display: flex;
  flex: 1;
  min-height: 0;
}
.tl-headers {
  width: 110px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.header-spacer {
  height: 28px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.header-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
}
.header-title {
  font-size: 12px;
  color: var(--text);
  white-space: nowrap;
}
.header-add {
  padding: 0 6px;
  line-height: 18px;
  font-size: 12px;
}
.header-fill {
  flex: 1;
}
.tl-scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  position: relative;
  background: var(--bg);
}
.tl-canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
}
.tl-empty {
  height: 80px;
  border-bottom: 1px solid var(--border);
}
.tl-loop {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(224, 180, 72, 0.12);
  pointer-events: none;
  z-index: 1;
}
.tl-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px solid var(--error);
  z-index: 2;
  pointer-events: none;
}
.playhead-handle {
  position: absolute;
  top: 0;
  left: -5px;
  width: 10px;
  height: 12px;
  background: var(--error);
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  pointer-events: auto;
  cursor: ew-resize;
}
</style>
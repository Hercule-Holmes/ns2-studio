<script setup lang="ts">
import { computed, ref } from "vue";
import { pxToMs } from "../format";
import { timelineStore } from "../store";
import type { AnyClip, TrackDef } from "../store";

const props = defineProps<{ def: TrackDef; clip: AnyClip; trackId: string }>();

const store = timelineStore;

const selected = computed(() => store.selectedIds.includes(props.clip.id));

const leftPx = computed(() => (props.clip.startMs / 1000) * store.editor.zoom);
const widthPx = computed(() =>
  Math.max(1, ((props.clip.endMs - props.clip.startMs) / 1000) * store.editor.zoom),
);

const isStick = computed(() => props.def.type === "stick");
const isMarker = computed(() => props.def.type === "marker");
const isAmiibo = computed(() => props.def.type === "amiibo");

const label = computed(() => {
  if (props.def.type === "buttons") {
    return (props.clip as { key: string }).key;
  }
  if (props.def.type === "hat") {
    return `DP${(props.clip as { hat: number }).hat}`;
  }
  if (props.def.type === "amiibo") {
    return `SLOT${(props.clip as { slot: number }).slot}`;
  }
  if (props.def.type === "marker") {
    return (props.clip as { label: string }).label;
  }
  return "";
});

const polyline = computed(() => {
  if (!isStick.value) return null;
  const clip = props.clip as { startMs: number; endMs: number; keyframes: { offsetMs: number; x: number; y: number }[] };
  const span = Math.max(1, clip.endMs - clip.startMs);
  return clip.keyframes
    .map((k) => {
      const fx = (k.offsetMs / span) * 100;
      const fy = ((255 - k.y) / 255) * 100;
      return `${fx.toFixed(1)},${fy.toFixed(1)}`;
    })
    .join(" ");
});

const dragging = ref<"move" | "resize" | null>(null);
const startClientX = ref(0);
const startStartMs = ref(0);
const startEndMs = ref(0);

function snapTime(ms: number): number {
  let snapped = store.snapTime(ms);
  const head = store.editor.playheadMs;
  if (Math.abs(head - snapped) * (store.editor.zoom / 1000) <= 8) snapped = head;
  return snapped;
}

function onPointerDown(e: PointerEvent, mode: "move" | "resize"): void {
  if (props.def.readonly) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    store.toggleSelect(props.clip.id);
  } else {
    store.selectOnly(props.clip.id);
  }
  if (mode === "move" && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
    dragging.value = mode;
    startClientX.value = e.clientX;
    startStartMs.value = props.clip.startMs;
    startEndMs.value = props.clip.endMs;
    store.beginTransaction();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } else if (mode === "resize") {
    dragging.value = mode;
    startClientX.value = e.clientX;
    startStartMs.value = props.clip.startMs;
    startEndMs.value = props.clip.endMs;
    store.beginTransaction();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return;
  const dx = e.clientX - startClientX.value;
  const dMs = pxToMs(dx, store.editor.zoom);
  if (dragging.value === "move") {
    const newStart = snapTime(startStartMs.value + dMs);
    const dur = startEndMs.value - startStartMs.value;
    store.moveClip(props.trackId, props.clip.id, newStart, newStart + dur);
  } else {
    store.resizeClipEnd(props.trackId, props.clip.id, snapTime(startEndMs.value + dMs));
  }
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = null;
  store.commitTransaction();
}
</script>

<template>
  <div
    class="clip"
    :class="[
      `clip-${def.type}`,
      { selected, readonly: def.readonly, marker: isMarker },
    ]"
    :style="{ left: leftPx + 'px', width: widthPx + 'px' }"
    @pointerdown="onPointerDown($event, 'move')"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <svg v-if="isStick" class="stick-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline v-if="polyline" :points="polyline" />
    </svg>
    <template v-if="isMarker">
      <span class="marker-flag">◆</span>
      <span class="clip-label">{{ label }}</span>
    </template>
    <span v-else-if="isStick" class="clip-label clip-label-center">{{ label || "摇杆" }}</span>
    <span v-else class="clip-label">{{ label }}</span>
    <div
      v-if="!def.readonly && !isMarker"
      class="resize-handle"
      title="拖拽修改结束时间"
      @pointerdown.stop="onPointerDown($event, 'resize')"
      @pointermove.stop="onPointerMove"
      @pointerup.stop="onPointerUp"
      @pointercancel.stop="onPointerUp"
    ></div>
  </div>
</template>

<style scoped>
.clip {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 4px;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  border: 1px solid transparent;
}
.clip-buttons {
  background: rgba(79, 140, 255, 0.28);
  border-color: var(--accent-dim);
}
.clip-stick {
  background: rgba(62, 207, 142, 0.18);
  border-color: rgba(62, 207, 142, 0.6);
}
.clip-hat {
  background: rgba(224, 180, 72, 0.2);
  border-color: rgba(224, 180, 72, 0.55);
}
.clip-marker {
  background: transparent;
  border-color: var(--text);
}
.clip-amiibo {
  background: rgba(139, 145, 160, 0.15);
  border-color: rgba(139, 145, 160, 0.5);
}
.clip.selected {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
.clip.readonly {
  cursor: default;
}
.clip-label {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  pointer-events: none;
}
.clip-label-center {
  top: 50%;
  transform: translateY(-50%);
  left: 6px;
  color: var(--text-dim);
}
.stick-svg {
  position: absolute;
  inset: 4px;
  width: calc(100% - 8px);
  height: calc(100% - 8px);
}
.stick-svg polyline {
  fill: none;
  stroke: var(--ok);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.marker-flag {
  position: absolute;
  top: -1px;
  left: -1px;
  font-size: 14px;
  color: var(--text);
  pointer-events: none;
}
.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  background: rgba(255, 255, 255, 0.15);
  opacity: 0;
}
.clip:hover .resize-handle {
  opacity: 1;
}
</style>
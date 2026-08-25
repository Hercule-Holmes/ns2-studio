<script setup lang="ts">
import { computed } from "vue";
import { computeTicks, msToPx } from "../format";
import { timelineStore } from "../store";

const props = defineProps<{ viewportWidth: number; contentWidth: number }>();

const store = timelineStore;

const emit = defineEmits<{ pointerdown: [e: PointerEvent] }>();

const viewportMs = computed(() =>
  props.viewportWidth > 0 ? (props.viewportWidth / store.editor.zoom) * 1000 : 0,
);
const layout = computed(() =>
  computeTicks(store.editor.scrollMs, viewportMs.value, store.editor.zoom),
);

function leftOf(ms: number): string {
  return `${msToPx(ms, store.editor.zoom)}px`;
}
</script>

<template>
  <div
    class="tl-ruler"
    :style="{ width: contentWidth + 'px' }"
    @pointerdown="emit('pointerdown', $event)"
  >
    <template v-for="t in layout.major" :key="t.ms">
      <div
        v-for="i in 4"
        :key="`m${i}`"
        class="ruler-minor"
        :style="{ left: leftOf(t.ms + layout.minorStepMs * i) }"
      ></div>
      <div class="ruler-major" :style="{ left: leftOf(t.ms) }">
        <span>{{ t.label }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tl-ruler {
  position: relative;
  height: 28px;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  cursor: text;
}
.ruler-major {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--border);
}
.ruler-major span {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
}
.ruler-minor {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 1px;
  background: var(--border);
  opacity: 0.5;
}
</style>
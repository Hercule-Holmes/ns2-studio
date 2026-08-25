<script setup lang="ts">
import { computed } from "vue";
import { timelineStore } from "../store";
import type { TrackDef } from "../store";
import ClipView from "./ClipView.vue";

const props = defineProps<{ def: TrackDef; rowHeight: number }>();

const store = timelineStore;
const track = computed(() => store.trackForDef(props.def));

const emit = defineEmits<{ backgroundDown: [e: PointerEvent] }>();
</script>

<template>
  <div
    class="track-row"
    :class="`track-${def.type}`"
    :style="{ height: rowHeight + 'px' }"
    @pointerdown.self="emit('backgroundDown', $event)"
  >
    <template v-if="track">
      <ClipView
        v-for="clip in (track.clips as unknown[])"
        :key="(clip as { id: string }).id"
        :def="def"
        :clip="clip as never"
        :track-id="track.id"
      />
    </template>
  </div>
</template>

<style scoped>
.track-row {
  position: relative;
  width: 100%;
  border-bottom: 1px solid var(--border);
}
.track-row:nth-child(even) {
  background: rgba(255, 255, 255, 0.02);
}
.track-buttons {
  border-left: 2px solid var(--accent-dim);
}
.track-stick {
  border-left: 2px solid var(--ok);
}
.track-hat {
  border-left: 2px solid var(--warn);
}
.track-marker {
  border-left: 2px solid var(--text);
}
.track-amiibo {
  border-left: 2px solid rgba(139, 145, 160, 0.6);
}
</style>
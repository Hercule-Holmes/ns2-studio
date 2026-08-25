<script setup lang="ts">
import { computed } from "vue";
import type {
  AmiiboClip,
  ButtonClip,
  HatClip,
  MarkerClip,
  StickClip,
} from "@ns2-studio/timeline-model";
import { timelineStore } from "../store";
import NumberField from "./NumberField.vue";
import TextField from "./TextField.vue";

const store = timelineStore;

const selCount = computed(() => store.selectedIds.length);
const last = computed(() => store.lastSelectedClip());
const selType = computed(() => last.value?.track.type ?? null);

const clipId = computed(() => last.value?.clip.id ?? "");
const trackId = computed(() => last.value?.track.id ?? "");

const startMs = computed(() => last.value?.clip.startMs ?? 0);
const endMs = computed(() => last.value?.clip.endMs ?? 0);
const keyVal = computed(() => (last.value?.clip as ButtonClip | undefined)?.key ?? "");
const hatVal = computed(() => (last.value?.clip as HatClip | undefined)?.hat ?? 8);
const slotVal = computed(() => (last.value?.clip as AmiiboClip | undefined)?.slot ?? 0);
const labelVal = computed(() => (last.value?.clip as MarkerClip | undefined)?.label ?? "");
const stickKfs = computed(() =>
  last.value?.track.type === "stick"
    ? (last.value.clip as StickClip).keyframes
    : [],
);

const commitStart = (v: number) => store.updateClipField(trackId.value, clipId.value, "startMs", v);
const commitEnd = (v: number) => store.updateClipField(trackId.value, clipId.value, "endMs", v);
const commitKey = (v: string) => store.updateClipField(trackId.value, clipId.value, "key", v);
const commitHat = (v: number) => store.updateClipField(trackId.value, clipId.value, "hat", v);
const commitSlot = (v: number) => store.updateClipField(trackId.value, clipId.value, "slot", v);
const commitLabel = (v: string) => store.updateClipField(trackId.value, clipId.value, "label", v);

const commitName = (v: string) => store.updateProjectField("name", v);
const commitDuration = (v: number) => store.updateProjectField("durationMs", v);
const commitGrid = (v: number) => store.updateProjectField("gridMs", v);
</script>

<template>
  <aside class="tl-prop">
    <h3>属性</h3>

    <div v-if="selCount === 0" class="prop-section">
      <TextField label="名称" :value="store.project.name" :commit="commitName" />
      <NumberField label="时长(ms)" :value="store.project.durationMs" :commit="commitDuration" />
      <NumberField label="网格(ms)" :value="store.project.gridMs" :min="1" :commit="commitGrid" />
    </div>

    <template v-else-if="selCount === 1">
      <div class="prop-section">
        <p class="type-hint">片段类型：{{ selType }}</p>
        <NumberField label="开始(ms)" :value="startMs" :commit="commitStart" />
        <NumberField label="结束(ms)" :value="endMs" :commit="commitEnd" />

        <TextField
          v-if="selType === 'buttons'"
          label="按键"
          :value="keyVal"
          :commit="commitKey"
        />
        <NumberField
          v-else-if="selType === 'hat'"
          label="十字键"
          :value="hatVal"
          :min="0"
          :commit="commitHat"
        />
        <NumberField
          v-else-if="selType === 'amiibo'"
          label="槽位"
          :value="slotVal"
          :min="0"
          :max="15"
          :commit="commitSlot"
        />
        <TextField
          v-else-if="selType === 'marker'"
          label="标签"
          :value="labelVal"
          :commit="commitLabel"
        />
      </div>

      <div v-if="selType === 'stick'" class="prop-section">
        <h4>关键帧</h4>
        <div class="kf-list">
          <div v-for="(kf, i) in stickKfs" :key="i" class="kf-row">
            <NumberField
              label="offset"
              :value="kf.offsetMs"
              :commit="(v: number) => store.updateStickKeyframe(trackId, clipId, i, { offsetMs: v })"
            />
            <NumberField
              label="X"
              :value="kf.x"
              :commit="(v: number) => store.updateStickKeyframe(trackId, clipId, i, { x: v })"
            />
            <NumberField
              label="Y"
              :value="kf.y"
              :commit="(v: number) => store.updateStickKeyframe(trackId, clipId, i, { y: v })"
            />
            <button
              class="kf-del"
              title="删除关键帧"
              :disabled="stickKfs.length <= 1"
              @click="store.removeStickKeyframe(trackId, clipId, i)"
            >
              ✕
            </button>
          </div>
        </div>
        <button class="kf-add" @click="store.addStickKeyframe(trackId, clipId)">＋ 关键帧</button>
      </div>
    </template>

    <div v-else class="prop-section">
      <p>已选中 {{ selCount }} 个片段</p>
      <p class="hint">按 Delete 删除，Ctrl+C / Ctrl+V 复制粘贴</p>
    </div>
  </aside>
</template>

<style scoped>
.tl-prop {
  width: 260px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: 12px;
  overflow-y: auto;
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
}
h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.prop-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.type-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.kf-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kf-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.kf-del {
  align-self: flex-end;
  padding: 2px 8px;
  font-size: 12px;
}
.kf-add {
  font-size: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
<script setup lang="ts">
import { computed } from "vue";
import { formatClock, formatTime } from "../format";
import { timelineStore } from "../store";
import { playback } from "../playback";
import { nextAmiiboHint } from "../amiibo-preview";

const store = timelineStore;

const clock = computed(() =>
  playback.state.transport === "playing"
    ? formatClock(playback.state.positionMs)
    : formatClock(store.editor.playheadMs),
);
const isPlaying = computed(() => playback.state.transport === "playing");
const isPaused = computed(() => playback.state.transport === "paused");

// S10 播放预览：基于当前播放头位置，显示下一个将切换的 Amiibo 槽位。
const nextAmiibo = computed(() =>
  nextAmiiboHint(
    store.project,
    isPlaying.value ? playback.state.positionMs : store.editor.playheadMs,
  ),
);

const emit = defineEmits<{
  play: [];
  pause: [];
  stop: [];
}>();
</script>

<template>
  <div class="tl-transport">
    <div class="t-clock" title="播放头位置">{{ clock }}</div>
    <div v-if="nextAmiibo" class="t-group">
      <span class="t-amiibo" title="下一个将切换的 Amiibo 槽位">
        Amiibo → SLOT{{ nextAmiibo.slot }} @ {{ formatTime(nextAmiibo.atMs) }}
      </span>
    </div>
    <div class="t-group">
      <button
        class="primary"
        title="播放 (从当前播放头位置)"
        @click="emit('play')"
      >
        {{ isPlaying ? "▶ 播放中" : "▶ 播放" }}
      </button>
      <button :disabled="!isPlaying" title="暂停" @click="emit('pause')">⏸ 暂停</button>
      <button title="停止（回放到 0 并中立）" @click="emit('stop')">⏹ 停止</button>
      <span v-if="playback.state.dryRun" class="t-badge">试播</span>
      <span v-if="playback.state.deviceLost" class="t-badge t-badge-warn">
        设备断开
      </span>
    </div>
    <div class="t-group">
      <button title="将循环入点设为播放头位置" @click="store.setLoopIn()">循环入点</button>
      <button title="将循环出点设为播放头位置" @click="store.setLoopOut()">循环出点</button>
      <button @click="store.clearLoop()">清除循环</button>
    </div>
    <div class="t-info">
      时长 {{ store.project.durationMs }}ms · 网格 {{ store.project.gridMs }}ms · 缩放
      {{ store.editor.zoom }}px/s
    </div>
  </div>
</template>

<style scoped>
.tl-transport {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
}
.t-clock {
  font-family: var(--mono);
  font-size: 18px;
  color: var(--accent);
}
.t-group {
  display: flex;
  gap: 6px;
  align-items: center;
}
.t-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(96, 180, 240, 0.15);
  color: var(--accent);
}
.t-badge-warn {
  background: rgba(240, 180, 72, 0.15);
  color: var(--warn);
}
.t-amiibo {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(139, 145, 160, 0.18);
  color: var(--text);
  border: 1px solid rgba(139, 145, 160, 0.5);
}
.t-info {
  flex: 1;
  text-align: right;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
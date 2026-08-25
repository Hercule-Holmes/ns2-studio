<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { LogLine } from "../../shared/ipc";

const props = defineProps<{ logs: LogLine[] }>();

const showHex = ref(false);
const listEl = ref<HTMLElement | null>(null);

watch(
  () => props.logs.length,
  async () => {
    await nextTick();
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight });
  },
);

function time(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="log-panel">
    <div class="log-toolbar">
      <span>日志</span>
      <label>
        <input v-model="showHex" type="checkbox" />
        HEX
      </label>
    </div>
    <div ref="listEl" class="log-list">
      <div
        v-for="(line, i) in logs"
        :key="i"
        class="log-line"
        :data-dir="line.dir"
      >
        <span class="log-ts">{{ time(line.ts) }}</span>
        <span class="log-text">{{ line.text }}</span>
        <span v-if="showHex && line.hex" class="log-hex">{{ line.hex }}</span>
      </div>
      <div v-if="logs.length === 0" class="log-empty">暂无日志</div>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  overflow: hidden;
}

.log-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
}

.log-list {
  flex: 1;
  overflow-y: auto;
  font-family: var(--mono);
  font-size: 12px;
  padding: 6px 12px;
}

.log-line {
  display: flex;
  gap: 10px;
  padding: 1px 0;
  white-space: nowrap;
}

.log-ts {
  color: var(--text-dim);
  flex-shrink: 0;
}

.log-text {
  flex-shrink: 0;
}

.log-hex {
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-line[data-dir="rx"] .log-text {
  color: var(--ok);
}

.log-line[data-dir="tx"] .log-text {
  color: var(--accent);
}

.log-line[data-dir="warn"] .log-text {
  color: var(--warn);
}

.log-line[data-dir="error"] .log-text {
  color: var(--error);
}

.log-empty {
  color: var(--text-dim);
  padding: 8px 0;
}
</style>
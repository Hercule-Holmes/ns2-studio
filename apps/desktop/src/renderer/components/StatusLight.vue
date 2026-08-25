<script setup lang="ts">
import { computed } from "vue";
import type { DeviceState } from "../../shared/ipc";

const props = defineProps<{ state: DeviceState }>();

const label = computed(() => {
  switch (props.state) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "handshaking":
      return "握手";
    case "error":
      return "错误";
    default:
      return "未连接";
  }
});
</script>

<template>
  <span class="status" :data-state="state">
    <span class="dot" />
    {{ label }}
  </span>
</template>

<style scoped>
.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 13px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-dim);
}

.status[data-state="connected"] .dot {
  background: var(--ok);
}

.status[data-state="connecting"] .dot,
.status[data-state="handshaking"] .dot {
  background: var(--warn);
}

.status[data-state="error"] .dot {
  background: var(--error);
}
</style>
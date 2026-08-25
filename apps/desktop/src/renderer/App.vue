<script setup lang="ts">
import { RouterView } from "vue-router";
import SidebarNav from "./components/SidebarNav.vue";
import { rendererError, dismissRendererError } from "./error-boundary";

function reload(): void {
  dismissRendererError();
  window.location.reload();
}
</script>

<template>
  <div class="shell">
    <SidebarNav />
    <main class="content">
      <RouterView />
    </main>

    <div v-if="rendererError.count > 0" class="error-overlay">
      <div class="error-dialog">
        <h2>发生未捕获错误</h2>
        <p class="error-message">{{ rendererError.message }}</p>
        <pre v-if="rendererError.stack" class="error-stack">{{
          rendererError.stack
        }}</pre>
        <p class="hint">
          错误已写入日志（userData/logs/crash.log）。可尝试刷新；若反复出现请反馈。
        </p>
        <div class="error-actions">
          <button class="primary" @click="reload">刷新</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 20px;
}

.error-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.error-dialog {
  max-width: 560px;
  width: 90%;
  background: var(--bg-panel);
  border: 1px solid var(--error);
  border-radius: 8px;
  padding: 20px;
}

.error-dialog h2 {
  margin: 0 0 8px;
  color: var(--error);
  font-size: 16px;
}

.error-message {
  margin: 0 0 8px;
}

.error-stack {
  max-height: 240px;
  overflow: auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-family: var(--mono);
  white-space: pre-wrap;
  word-break: break-all;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
}

.error-actions {
  display: flex;
  gap: 8px;
}
</style>
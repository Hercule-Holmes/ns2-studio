<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { timelineStore } from "../timeline/store";
import { playback } from "../timeline/playback";
import TimelineToolbar from "../timeline/components/TimelineToolbar.vue";
import TimelineEditor from "../timeline/components/TimelineEditor.vue";
import TransportBar from "../timeline/components/TransportBar.vue";
import PropertyPanel from "../timeline/components/PropertyPanel.vue";

const store = timelineStore;
const notice = ref<string | null>(null);
let noticeTimer: number | undefined;

const isPlaying = computed(() => playback.state.transport === "playing");

function flash(msg: string): void {
  notice.value = msg;
  if (noticeTimer) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (notice.value = null), 4000);
}

function onNew(): void {
  if (store.dirty && !window.confirm("工程有未保存更改，确定新建并丢弃？")) return;
  store.newProject();
  void playback.load();
}

async function onOpen(): Promise<void> {
  if (store.dirty && !window.confirm("工程有未保存更改，确定打开并丢弃？")) return;
  const res = await window.api.project.open();
  if (res.canceled) return;
  if (!res.ok || res.content === undefined) {
    flash(`打开失败：${res.error ?? "未知错误"}`);
    return;
  }
  try {
    store.openFromContent(res.content, res.path ?? null);
    await playback.load();
  } catch (err) {
    flash(`打开失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function onSave(): Promise<void> {
  const err = store.validate();
  if (err) {
    flash("无法保存：工程校验失败，请先修正属性面板中的错误");
    return;
  }
  const defaultName = `${store.project.name || "未命名工程"}.nsproj.json`;
  const res = await window.api.project.save(
    store.filePath,
    store.serialize(),
    defaultName,
  );
  if (res.canceled) return;
  if (res.ok) store.markSaved(res.path ?? store.filePath);
  else flash(`保存失败：${res.error ?? "未知错误"}`);
}

async function onPlay(): Promise<void> {
  const res = await playback.play();
  if (res.ok) return;
  // 未连接设备：错误提示 + 允许试播（仅移动播放头）
  if (res.error?.includes("未连接")) {
    flash(res.error);
    if (window.confirm("设备未连接。是否以试播模式运行（仅移动播放头）？")) {
      const dry = await playback.retryDryRun();
      if (!dry.ok) flash(dry.error ?? "试播失败");
    }
    return;
  }
  flash(res.error ?? "播放失败");
}

async function onPause(): Promise<void> {
  await playback.pause();
}

async function onStop(): Promise<void> {
  await playback.stop();
}

function isFormTarget(t: HTMLElement | null): boolean {
  return (
    t !== null &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")
  );
}

function onKeydown(e: KeyboardEvent): void {
  if (isPlaying.value) return; // 播放中整页只读，编辑快捷键全部让位
  if (isFormTarget(e.target as HTMLElement | null)) {
    if (e.key === "Escape") store.cancelTransaction();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    store.removeSelected();
    return;
  }
  if (e.key === "Escape") {
    store.cancelTransaction();
    return;
  }
  if (mod && (e.key === "z" || e.key === "Z")) {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && (e.key === "y" || e.key === "Y")) {
    e.preventDefault();
    store.redo();
    return;
  }
  if (mod && (e.key === "c" || e.key === "C")) {
    e.preventDefault();
    store.copySelected();
    return;
  }
  if (mod && (e.key === "v" || e.key === "V")) {
    e.preventDefault();
    store.paste();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  void playback.load();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="timeline-page">
    <TimelineToolbar :readonly="isPlaying" @new-project="onNew" @open="onOpen" @save="onSave" />
    <div v-if="store.validationError" class="error-banner">
      <span>校验错误：</span>{{ store.validationError }}
    </div>
    <div v-if="notice" class="notice-banner">{{ notice }}</div>
    <div class="editor-wrap">
      <TimelineEditor />
      <PropertyPanel />
      <div v-if="isPlaying" class="playing-overlay">播放中（只读）</div>
    </div>
    <TransportBar @play="onPlay" @pause="onPause" @stop="onStop" />
  </div>
</template>

<style scoped>
.timeline-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.error-banner {
  background: rgba(240, 96, 96, 0.15);
  color: var(--error);
  border-bottom: 1px solid var(--error);
  padding: 6px 12px;
  font-size: 12px;
}
.error-banner span {
  font-weight: 600;
}
.notice-banner {
  background: rgba(224, 180, 72, 0.15);
  color: var(--warn);
  border-bottom: 1px solid var(--warn);
  padding: 6px 12px;
  font-size: 12px;
}
.editor-wrap {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}
.playing-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(16, 20, 28, 0.45);
  color: var(--text);
  font-size: 15px;
  letter-spacing: 2px;
  pointer-events: auto;
  user-select: none;
}
</style>
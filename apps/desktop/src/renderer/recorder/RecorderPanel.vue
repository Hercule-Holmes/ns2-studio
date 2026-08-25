<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { Project, Recording, RecordingSource } from "@ns2-studio/timeline-model";
import { parseRecording, serializeRecording } from "../../shared/nsrec";
import type { HubSource, RecorderState } from "../../shared/ipc";
import { timelineStore } from "../timeline/store";
import { bakeRecording } from "./bake";
import { useReplay } from "./use-replay";

const props = defineProps<{
  deviceConnected: boolean;
  source: HubSource;
}>();

const router = useRouter();

const state = ref<RecorderState>("idle");
const elapsedMs = ref(0);
const recording = ref<Recording | null>(null);
const notice = ref<string | null>(null);
const deadZone = ref(4);
const minButtonMs = ref(0);
const showBake = ref(false);

const replay = useReplay();

let tickTimer: number | undefined;
let startedAt = 0;
let noticeTimer: number | undefined;
const disposers: Array<() => void> = [];

const canRecord = computed(
  () =>
    props.deviceConnected &&
    (props.source === "manual" || props.source === "forward"),
);
const hasRecording = computed(
  () => recording.value !== null && recording.value.frames.length > 0,
);
const frameCount = computed(() => recording.value?.frames.length ?? 0);
const recordingDurationMs = computed(() => {
  const last = recording.value?.frames.at(-1);
  return last ? last.tUs / 1000 : 0;
});

function flash(msg: string): void {
  notice.value = msg;
  if (noticeTimer) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (notice.value = null), 4000);
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const ds = Math.floor((ms % 1000) / 100);
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}.${ds}` : `${s}.${ds}s`;
}

function defaultRecName(rec: Recording): string {
  const d = new Date(rec.meta.createdAt);
  const label = Number.isNaN(d.getTime()) ? "录制" : d.toLocaleString();
  return `录制 ${label}`;
}

function startElapsedTimer(): void {
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
  startedAt = performance.now();
  elapsedMs.value = 0;
  tickTimer = window.setInterval(() => {
    elapsedMs.value = performance.now() - startedAt;
  }, 100);
}

function clearElapsedTimer(): void {
  if (tickTimer !== undefined) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
}

async function startRecord(): Promise<void> {
  if (!canRecord.value) return;
  const src = props.source as RecordingSource;
  await window.api.recorder.start(src);
  state.value = await window.api.recorder.getState();
  if (state.value === "recording") {
    replay.stop();
    recording.value = null;
    startElapsedTimer();
    flash("开始录制");
  }
}

async function stopRecord(): Promise<void> {
  clearElapsedTimer();
  const res = await window.api.recorder.stop();
  if (res.ok && res.content !== undefined) {
    try {
      recording.value = parseRecording(res.content);
      flash(
        `已录制 ${formatMs(recordingDurationMs.value)}（${frameCount.value} 帧）`,
      );
    } catch (err) {
      flash(
        `录制结果解析失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    flash(`停止失败：${res.error ?? "未知错误"}`);
  }
  state.value = await window.api.recorder.getState();
}

async function resetRec(): Promise<void> {
  replay.stop();
  await window.api.recorder.reset();
  state.value = await window.api.recorder.getState();
  recording.value = null;
}

async function loadRec(): Promise<void> {
  const res = await window.api.recorder.open();
  if (res.canceled) return;
  if (!res.ok || res.content === undefined) {
    flash(`打开失败：${res.error ?? "未知错误"}`);
    return;
  }
  try {
    recording.value = parseRecording(res.content);
    flash(`已加载录制（${frameCount.value} 帧）`);
  } catch (err) {
    flash(`打开失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function saveRec(): Promise<void> {
  if (!recording.value) return;
  const res = await window.api.recorder.save(
    null,
    serializeRecording(recording.value),
    `${defaultRecName(recording.value)}.nsrec.json`,
  );
  if (res.canceled) return;
  if (res.ok) flash(`已保存：${res.path}`);
  else flash(`保存失败：${res.error ?? "未知错误"}`);
}

async function toggleReplay(): Promise<void> {
  if (replay.state.playing) {
    replay.stop();
    return;
  }
  if (!recording.value) return;
  if (!props.deviceConnected) {
    flash("未连接设备，无法回放");
    return;
  }
  try {
    await replay.start(recording.value);
  } catch (err) {
    flash(`回放失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

function bakeCurrent():
  | { ok: true; project: Project }
  | { ok: false; error: string } {
  if (!recording.value) return { ok: false, error: "没有可烘焙的录制" };
  try {
    const project = bakeRecording(recording.value, {
      name: defaultRecName(recording.value),
      deadZone: deadZone.value,
      minButtonMs: minButtonMs.value,
    });
    return { ok: true, project };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function onBake(): void {
  const result = bakeCurrent();
  if (!result.ok) {
    flash(`烘焙失败：${result.error ?? "未知错误"}`);
    return;
  }
  const project = result.project;
  try {
    timelineStore.openFromContent(JSON.stringify(project), null);
    void router.push("/timeline");
  } catch (err) {
    flash(`设为当前工程失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

async function onBakeSave(): Promise<void> {
  const result = bakeCurrent();
  if (!result.ok) {
    flash(`烘焙失败：${result.error ?? "未知错误"}`);
    return;
  }
  const project = result.project;
  const res = await window.api.project.save(
    null,
    JSON.stringify(project, null, 2),
    `${project.name}.nsproj.json`,
  );
  if (res.canceled) return;
  if (res.ok) flash(`已保存工程：${res.path}`);
  else flash(`保存失败：${res.error ?? "未知错误"}`);
}

onMounted(async () => {
  state.value = await window.api.recorder.getState();
  if (state.value === "recording") startElapsedTimer();
  disposers.push(
    window.api.recorder.onStateChanged((s) => {
      state.value = s;
      if (s === "recording") startElapsedTimer();
      else clearElapsedTimer();
    }),
  );
});

onBeforeUnmount(() => {
  clearElapsedTimer();
  replay.stop();
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <section class="card recorder-card">
    <div class="recorder-head">
      <h2>帧录制</h2>
      <span class="hint">
        {{
          !deviceConnected
            ? "未连接设备。可设置 NS2_STUDIO_MOCK_SERIAL=1 用 mock 体验全链路。"
            : canRecord
              ? "输出源为 manual/forward，旁路录制输入流。"
              : "请将输出源切到 manual 或 forward 再录制。"
        }}
      </span>
    </div>

    <div class="recorder-controls">
      <button
        class="record-btn"
        :data-recording="state === 'recording'"
        :disabled="!canRecord && state !== 'recording'"
        @click="state === 'recording' ? stopRecord() : startRecord()"
      >
        <span class="record-dot" />
        {{ state === "recording" ? "停止录制" : "开始录制" }}
      </button>
      <span v-if="state === 'recording'" class="rec-timer">
        {{ formatMs(elapsedMs) }}
      </span>
      <span v-else-if="hasRecording" class="rec-timer">
        {{ formatMs(recordingDurationMs) }} · {{ frameCount }} 帧
      </span>
      <button
        class="ghost"
        :disabled="state === 'recording' || !hasRecording"
        @click="resetRec"
      >
        清空
      </button>
      <button class="ghost" :disabled="state === 'recording'" @click="loadRec">
        加载 .nsrec.json
      </button>
    </div>

    <div v-if="hasRecording" class="recorder-actions">
      <button :disabled="state === 'recording'" @click="saveRec">
        保存 .nsrec.json
      </button>
      <button :disabled="state === 'recording'" @click="toggleReplay">
        {{ replay.state.playing ? "停止回放" : "回放" }}
      </button>
      <button
        class="ghost"
        :disabled="state === 'recording'"
        @click="showBake = !showBake"
      >
        {{ showBake ? "收起烘焙选项" : "发送到时间轴…" }}
      </button>
    </div>

    <div v-if="showBake && hasRecording" class="bake-options">
      <label class="field">
        <span>摇杆死区</span>
        <input v-model.number="deadZone" type="number" min="0" max="127" />
      </label>
      <label class="field">
        <span>最小按键时长 (ms)</span>
        <input v-model.number="minButtonMs" type="number" min="0" step="10" />
      </label>
      <div class="bake-actions">
        <button class="primary" :disabled="state === 'recording'" @click="onBake">
          烘焙 → 设为当前工程
        </button>
        <button :disabled="state === 'recording'" @click="onBakeSave">
          另存 .nsproj.json
        </button>
      </div>
      <p class="hint">
        烘焙调用 timeline-model bake（摇杆死区）；最小按键时长会丢弃过短的
        button clips。
      </p>
    </div>

    <p v-if="notice" class="rec-notice">{{ notice }}</p>
  </section>
</template>

<style scoped>
.recorder-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recorder-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.recorder-head h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}

.recorder-controls,
.recorder-actions,
.bake-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.record-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 14px;
  cursor: pointer;
}

.record-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.record-btn[data-recording="true"] {
  border-color: var(--error);
  color: var(--error);
}

.record-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-dim);
}

.record-btn[data-recording="true"] .record-dot {
  background: var(--error);
  box-shadow: 0 0 6px var(--error);
  animation: rec-blink 1s ease-in-out infinite;
}

@keyframes rec-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.rec-timer {
  font-family: var(--mono);
  font-size: 14px;
  color: var(--text);
}

.ghost {
  background: transparent;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.field span {
  color: var(--text-dim);
  font-size: 12px;
}

.field input {
  width: 90px;
}

.rec-notice {
  margin: 0;
  color: var(--warn);
  font-size: 12px;
}
</style>
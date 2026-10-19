<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { PadReport } from "@ns2-studio/pad-types";
import { SwitchButton, STICK_CENTER } from "@ns2-studio/pad-types";
import type {
  CaptureDeviceInfo,
  CaptureStatus,
  DeviceStatus,
  LogLine,
} from "../../shared/ipc";
import LogPanel from "../components/LogPanel.vue";
import StatusLight from "../components/StatusLight.vue";

const BAUD_OPTIONS = [115200, 9600];

const ports = ref<string[]>([]);
const selectedPort = ref("");
const baud = ref(115200);
const status = ref<DeviceStatus>({ state: "disconnected" });
const logs = ref<LogLine[]>([]);
const busy = ref(false);
const showDebug = ref(false);

const captureDevices = ref<CaptureDeviceInfo[]>([]);
const captureStatus = ref<CaptureStatus>({ state: "idle", initMode: "listen-only" });
const captureBusy = ref(false);

const isConnected = computed(() => status.value.state === "connected");
const busyText = computed(() =>
  status.value.state === "connecting" || status.value.state === "handshaking"
    ? "连接中…"
    : "连接",
);
const captureRunning = computed(
  () =>
    captureStatus.value.state === "streaming" ||
    captureStatus.value.state === "connecting",
);
const captureStatusText = computed(() => {
  const s = captureStatus.value.state;
  const label =
    s === "streaming"
      ? `采集转发中（init=${captureStatus.value.initMode}）`
      : s === "connecting"
        ? "连接中…"
        : s === "unsupported"
          ? "不支持（报告格式不符，已停止）"
          : s === "error"
            ? "错误"
            : "空闲";
  return captureStatus.value.error ? `${label}：${captureStatus.value.error}` : label;
});

const disposers: Array<() => void> = [];

async function refreshPorts(): Promise<void> {
  ports.value = await window.api.device.listPorts();
  if (!selectedPort.value && ports.value.length > 0) {
    selectedPort.value = ports.value[0] ?? "";
  }
}

async function connect(): Promise<void> {
  if (!selectedPort.value) return;
  busy.value = true;
  try {
    const result = await window.api.device.connect(selectedPort.value, baud.value);
    if (result.ok) {
      await window.api.settings.update({
        lastPort: selectedPort.value,
        lastBaud: baud.value,
      });
    }
  } finally {
    busy.value = false;
  }
}

async function disconnect(): Promise<void> {
  await window.api.device.disconnect();
}

async function sendNeutral(): Promise<void> {
  await window.api.device.sendNeutral();
}

async function sendDebugReport(): Promise<void> {
  const report: PadReport = {
    buttons: SwitchButton.A,
    hat: 8,
    lx: STICK_CENTER,
    ly: STICK_CENTER,
    rx: STICK_CENTER,
    ry: STICK_CENTER,
  };
  await window.api.device.sendReport(report);
}

const wakeBusy = ref(false);
const wakeResult = ref<string | null>(null);
const wakeOk = ref(false);

async function wakeHost(): Promise<void> {
  if (wakeBusy.value) return;
  wakeBusy.value = true;
  wakeResult.value = null;
  try {
    const r = await window.api.device.wake();
    wakeOk.value = r.ok;
    wakeResult.value = r.ok ? (r.message ?? "已唤醒") : (r.message ?? "唤醒失败");
  } catch (err) {
    wakeOk.value = false;
    wakeResult.value = err instanceof Error ? err.message : String(err);
  } finally {
    wakeBusy.value = false;
  }
}

async function refreshCapture(): Promise<void> {
  captureDevices.value = await window.api.capture.list();
  captureStatus.value = await window.api.capture.getStatus();
}

async function startCapture(): Promise<void> {
  if (captureRunning.value) return;
  captureBusy.value = true;
  try {
    await window.api.capture.start();
  } finally {
    captureBusy.value = false;
  }
}

async function stopCapture(): Promise<void> {
  await window.api.capture.stop();
}

onMounted(async () => {
  const settings = await window.api.settings.get();
  if (settings.lastPort) selectedPort.value = settings.lastPort;
  if (settings.lastBaud) baud.value = settings.lastBaud;

  await refreshPorts();
  status.value = await window.api.device.getStatus();
  logs.value = await window.api.device.subscribeLog();
  await refreshCapture();

  disposers.push(
    window.api.device.onStateChanged((s) => {
      status.value = s;
    }),
    window.api.device.onLog((line) => {
      logs.value.push(line);
    }),
    window.api.capture.onStateChanged((s) => {
      captureStatus.value = s;
    }),
  );
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <div class="device-page">
    <h1>设备</h1>

    <section class="card">
      <h2>串口连接</h2>
      <div class="row">
        <label class="field">
          <span>端口</span>
          <select v-model="selectedPort">
            <option v-for="p in ports" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="field">
          <span>波特率</span>
          <select v-model.number="baud">
            <option v-for="b in BAUD_OPTIONS" :key="b" :value="b">{{ b }}</option>
          </select>
        </label>
        <button class="ghost" :disabled="busy" @click="refreshPorts">刷新</button>
        <button
          class="primary"
          :disabled="busy || !selectedPort || isConnected"
          @click="connect"
        >
          {{ busyText }}
        </button>
        <button :disabled="!isConnected" @click="disconnect">断开</button>
      </div>

      <div class="status-row">
        <StatusLight :state="status.state" />
        <span v-if="status.path" class="status-meta">{{ status.path }}</span>
        <span v-if="status.version" class="status-meta">
          版本 {{ status.version }}
        </span>
        <span v-if="status.error" class="status-error">{{ status.error }}</span>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <h2>指令</h2>
        <button :disabled="!isConnected" @click="sendNeutral">发送中立</button>
        <button
          class="primary"
          :disabled="!isConnected || wakeBusy"
          :title="'主机休眠时经 USB 远程唤醒（CMD_WAKE 0x92，需固件支持）'"
          @click="wakeHost"
        >
          {{ wakeBusy ? "唤醒中…" : "唤醒主机" }}
        </button>
        <label>
          <input v-model="showDebug" type="checkbox" />
          调试
        </label>
      </div>
      <p v-if="wakeResult" class="hint" :class="{ 'wake-error': !wakeOk }">
        {{ wakeResult }}
      </p>
      <div v-if="showDebug" class="debug-row">
        <p class="hint">
          调试通道：通过主进程写队列下发一帧报告（A 键按下）。正式功能请走
          InputHub（S3）。
        </p>
        <button :disabled="!isConnected" @click="sendDebugReport">
          下发测试报告 (A)
        </button>
      </div>
    </section>

    <section class="card">
      <div class="row">
        <h2>NS2 Pro 采集（forward）</h2>
        <button class="ghost" :disabled="captureBusy" @click="refreshCapture">
          刷新设备
        </button>
        <button
          class="primary"
          :disabled="captureBusy || captureRunning"
          @click="startCapture"
        >
          开始转发
        </button>
        <button :disabled="!captureRunning" @click="stopCapture">停止</button>
      </div>

      <div class="status-row">
        <StatusLight
          :state="
            captureStatus.state === 'streaming'
              ? 'connected'
              : captureStatus.state === 'connecting'
                ? 'connecting'
                : captureStatus.state === 'error' ||
                    captureStatus.state === 'unsupported'
                  ? 'error'
                  : 'disconnected'
          "
        />
        <span class="status-meta">{{ captureStatusText }}</span>
        <span v-if="captureStatus.device" class="status-meta">
          {{ captureStatus.device.product ?? "NS2 Pro" }}
        </span>
      </div>

      <div v-if="captureStatus.loadError" class="hint capture-hint-warn">
        node-hid 加载失败，采集功能不可用：{{ captureStatus.loadError }}
      </div>

      <p v-if="captureDevices.length === 0 && !captureStatus.loadError" class="hint">
        未发现有线 NS2 Pro（VID 0x057E / PID 0x2069，安全模式 0x2072 已排除）。
        插上手柄后点「刷新设备」。
      </p>
      <div v-else class="capture-devices">
        <div v-for="d in captureDevices" :key="d.path" class="capture-device">
          <span class="mono">{{ d.product ?? "NS2 Pro" }}</span>
          <span class="status-meta">
            0x{{ d.vid.toString(16).padStart(4, "0") }}:0x{{
              d.pid.toString(16).padStart(4, "0")
            }}
          </span>
          <span class="status-meta mono">{{ d.path }}</span>
        </div>
      </div>
      <p class="hint">
        采集解析为 PadReport 后经 InputHub <code>forward</code> 源下发到设备；
        停止或拔线自动中立。C/GL/GR 无对应位，MVP 忽略（R11）。
      </p>
    </section>

    <section class="log-card">
      <LogPanel :logs="logs" />
    </section>
  </div>
</template>

<style scoped>
.device-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.device-page h1 {
  margin: 0;
  font-size: 22px;
}

.card,
.log-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 16px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.row h2 {
  margin: 0;
  align-self: center;
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

.status-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 14px;
}

.status-meta {
  color: var(--text-dim);
  font-size: 13px;
}

.status-error {
  color: var(--error);
  font-size: 13px;
}

.ghost {
  background: transparent;
}

.debug-row {
  margin-top: 12px;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0 0 8px;
}

.capture-hint-warn {
  color: var(--warn);
  margin-top: 8px;
}

.wake-error {
  color: var(--error);
}

.capture-devices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.capture-device {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
}

.mono {
  font-family: var(--mono);
}

.log-card {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 0;
  overflow: hidden;
}

.log-card > * {
  flex: 1;
}
</style>
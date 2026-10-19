<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import QRCode from "qrcode";
import type { RemoteStatus } from "../../shared/ipc";
import {
  VideoStreamService,
  type VideoStreamStatus,
} from "../remote/video-stream";

const status = ref<RemoteStatus | null>(null);
const loaded = ref(false);
const busy = ref(false);
const actionError = ref<string | null>(null);
const qrDataUrl = ref<string | null>(null);
const selectedUrl = ref(0);
const copied = ref(false);

let offState: (() => void) | null = null;
let clockTimer: number | null = null;
const nowTick = ref(Date.now());

// S15 spike: capture-card enumeration + local getUserMedia preview.
// Results go to docs/lab-notes/S15-capture-card.md; WebRTC lands later.
interface VideoDeviceOption {
  deviceId: string;
  label: string;
}

const videoDevices = ref<VideoDeviceOption[]>([]);
const selectedVideoDeviceId = ref("");
const keepaliveMs = ref(20000);
const previewing = ref(false);
const videoBusy = ref(false);
const videoError = ref<string | null>(null);
const videoSettings = ref<{
  width?: number;
  height?: number;
  frameRate?: number;
} | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
let videoStream: MediaStream | null = null;

const webrtcStatus = ref<VideoStreamStatus>("idle");
const webrtcDetail = ref<string | null>(null);
let videoStreamService: VideoStreamService | null = null;
let offSignal: (() => void) | null = null;

const webrtcStatusText = computed(() => {
  switch (webrtcStatus.value) {
    case "connecting":
      return "手机协商中…";
    case "live":
      return "下行中";
    case "error":
      return `错误：${webrtcDetail.value ?? "未知"}`;
    default:
      return "空闲";
  }
});

const stateText = computed(() => {
  switch (status.value?.serverState) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中…";
    case "error":
      return `错误：${status.value.error ?? "未知"}`;
    default:
      return "已停止";
  }
});

const sessionDuration = computed(() => {
  const at = status.value?.client?.connectedAt;
  if (!at) return "";
  const s = Math.max(0, Math.floor((nowTick.value - at) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} 分 ${s % 60} 秒` : `${s} 秒`;
});

async function refreshQr(): Promise<void> {
  qrDataUrl.value = null;
  const url = status.value?.urls[selectedUrl.value]?.url;
  if (!url) return;
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      margin: 1,
      width: 220,
      color: { dark: "#111318", light: "#ffffff" },
    });
  } catch {
    qrDataUrl.value = null;
  }
}

async function load(): Promise<void> {
  status.value = await window.api.remote.getStatus();
  loaded.value = true;
  await refreshQr();
}

async function toggle(): Promise<void> {
  if (!status.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    status.value = await window.api.remote.setEnabled(!status.value.enabled);
    await refreshQr();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function rotate(): Promise<void> {
  busy.value = true;
  actionError.value = null;
  try {
    status.value = await window.api.remote.rotateToken();
    selectedUrl.value = 0;
    await refreshQr();
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function copyUrl(): Promise<void> {
  const url = status.value?.urls[selectedUrl.value]?.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard denied */
  }
}

function endpointLabel(address: string, kind: "lan" | "tailscale"): string {
  return kind === "tailscale" ? `${address}（Tailscale · 外出）` : `${address}（局域网）`;
}

async function refreshVideoDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    videoDevices.value = all
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `摄像头 ${i + 1}（未授权，先预览一次）`,
      }));
    if (
      selectedVideoDeviceId.value &&
      !videoDevices.value.some((d) => d.deviceId === selectedVideoDeviceId.value)
    ) {
      selectedVideoDeviceId.value = "";
    }
  } catch (err) {
    videoError.value = err instanceof Error ? err.message : String(err);
  }
}

function selectVideoDevice(id: string): void {
  selectedVideoDeviceId.value = id;
  void window.api.config.update({ remote: { videoDeviceId: id } });
}

const KEEPALIVE_OPTIONS = [
  { value: 0, label: "关闭" },
  { value: 10000, label: "10 秒" },
  { value: 20000, label: "20 秒" },
  { value: 30000, label: "30 秒" },
  { value: 60000, label: "60 秒" },
];

function selectKeepalive(ms: number): void {
  keepaliveMs.value = ms;
  void window.api.config.update({ remote: { keepaliveMs: ms } });
}

function stopPreview(): void {
  videoStream?.getTracks().forEach((t) => t.stop());
  videoStream = null;
  if (videoEl.value) videoEl.value.srcObject = null;
  previewing.value = false;
  videoSettings.value = null;
}

async function startPreview(): Promise<void> {
  if (videoBusy.value) return;
  videoBusy.value = true;
  videoError.value = null;
  stopPreview();
  const id = selectedVideoDeviceId.value;
  const video: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 },
  };
  if (id) video.deviceId = { exact: id };
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video });
    const track = videoStream.getVideoTracks()[0];
    if (!track) throw new Error("no video track");
    videoSettings.value = track.getSettings();
    if (videoEl.value) {
      videoEl.value.srcObject = videoStream;
      await videoEl.value.play().catch(() => {});
    }
    previewing.value = true;
    // Labels may become visible only after a successful getUserMedia.
    await refreshVideoDevices();
  } catch (err) {
    videoError.value = err instanceof Error ? err.message : String(err);
    stopPreview();
  } finally {
    videoBusy.value = false;
  }
}

onMounted(async () => {
  await load();
  offState = window.api.remote.onStateChanged(async (s) => {
    const hadClient = status.value?.client != null;
    status.value = s;
    if (selectedUrl.value >= s.urls.length) selectedUrl.value = 0;
    await refreshQr();
    // Session ended: release the downlink (and the capture card with it).
    if (hadClient && s.client == null) videoStreamService?.stop();
  });
  clockTimer = window.setInterval(() => (nowTick.value = Date.now()), 1000);
  try {
    const cfg = await window.api.config.get();
    selectedVideoDeviceId.value = cfg.remote.videoDeviceId ?? "";
    keepaliveMs.value = cfg.remote.keepaliveMs;
  } catch {
    /* config unavailable: keep default */
  }
  await refreshVideoDevices();

  videoStreamService = new VideoStreamService({
    send: (payload) => void window.api.remote.sendSignal(payload),
    getConfig: () => window.api.config.get(),
    onStatus: (s, detail) => {
      webrtcStatus.value = s;
      webrtcDetail.value = detail ?? null;
    },
  });
  offSignal = window.api.remote.onSignal(({ payload }) => {
    void videoStreamService?.handleSignal(payload);
  });
});

onUnmounted(() => {
  offState?.();
  offSignal?.();
  videoStreamService?.stop();
  if (clockTimer !== null) window.clearInterval(clockTimer);
  stopPreview();
});
</script>

<template>
  <div class="remote-page">
    <h1>远程</h1>

    <section class="card">
      <h2>远程服务</h2>
      <p class="hint">
        手机浏览器经本服务操控 NS：指令 → InputHub(remote 源) → 串口。
        家里用局域网；外出需 PC 与手机都安装并登录 Tailscale。
      </p>
      <div class="row">
        <span class="state-dot" :class="status?.enabled ? 'on' : 'off'" />
        <span>{{ stateText }}</span>
        <button
          class="primary"
          :disabled="!loaded || busy"
          @click="toggle"
        >
          {{ status?.enabled ? "停止服务" : "启动服务" }}
        </button>
        <span v-if="actionError" class="notice error">{{ actionError }}</span>
      </div>
      <p class="hint firewall">
        首次启动如无法连接，请允许 Windows 防火墙放行 Node.js（专用网络）。
      </p>
      <div class="row keepalive-row">
        <label class="field">
          <span>防休眠保活（远程会话期间）</span>
          <select
            :value="keepaliveMs"
            @change="selectKeepalive(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="o in KEEPALIVE_OPTIONS" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
        </label>
        <span class="dim">
          实测底座休眠会断开 USB（无法远程唤醒），保活通过周期微量输入阻止
          NS 自动休眠，仅 remote 源激活时运行。
        </span>
      </div>
    </section>

    <section v-if="status?.urls.length" class="card">
      <h2>扫码连接</h2>
      <p class="hint">
        手机浏览器扫码或在地址栏输入链接。链接内含访问令牌，请勿外传。
      </p>
      <div class="qr-row">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="远程连接二维码" class="qr" />
        <div v-else class="qr placeholder" />
        <div class="url-side">
          <select v-model.number="selectedUrl" @change="refreshQr">
            <option v-for="(e, i) in status?.urls" :key="e.url" :value="i">
              {{ endpointLabel(e.address, e.kind) }}
            </option>
          </select>
          <button @click="copyUrl">
            {{ copied ? "已复制" : "复制链接" }}
          </button>
        </div>
      </div>
    </section>

    <details class="card help-card">
      <summary>外出访问（Tailscale）—— 如何在家里之外操控</summary>
      <div class="help-body">
        <p class="hint">
          家里的 WiFi 只能在家用。出门（4G）访问需要 PC 与手机都安装
          <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a>
          并登录<strong>同一账号</strong>，无需任何端口映射：
        </p>
        <ol class="hint help-steps">
          <li>PC 与手机安装 Tailscale 并登录同一账号（PC 版随系统自启）</li>
          <li>出门时手机打开 Tailscale 开关（4G/热点均可）</li>
          <li>上方地址列表选标有「Tailscale · 外出」的 100.x 地址扫码</li>
        </ol>
        <p class="hint">
          首次连接若超时：Windows 防火墙首次启动服务时会弹放行提示，请允许
          「专用网络」；若错过，可在防火墙设置里放行本应用或 8787 端口。
        </p>
        <p class="hint">
          安全：100.x 流量经 Tailscale（WireGuard）端到端加密。切勿把 8787
          端口直接映射到公网；二维码/链接内含访问令牌，请勿外传。
        </p>
      </div>
    </details>

    <section class="card">
      <h2>访问令牌</h2>
      <div class="row">
        <code class="token">{{ status?.token ?? "—" }}</code>
        <button :disabled="busy" @click="rotate">重新生成</button>
      </div>
      <p class="hint">重新生成会立即断开当前手机会话，需重新扫码。</p>
    </section>

    <section class="card">
      <h2>会话</h2>
      <template v-if="status?.client">
        <div class="row">
          <span class="state-dot on" />
          <span>{{ status.client.peer }}</span>
          <span v-if="status.client.rttMs !== undefined" class="dim">
            延迟 {{ status.client.rttMs }} ms
          </span>
          <span class="dim">已连接 {{ sessionDuration }}</span>
        </div>
        <p class="hint">
          会话断开或超时（{{ "1s" }} 无消息）会自动下发中立并释放
          remote 输出源。
        </p>
      </template>
      <p v-else class="hint">暂无手机连接。</p>
    </section>

    <section class="card">
      <h2>视频下行（S15）</h2>
      <p class="hint">
        手机端「开启画面」后经 WebRTC 推送采集卡画面（sendonly，1080p60 /
        6Mbps 起步）。设备选择持久化到 config.remote.videoDeviceId。
      </p>
      <div class="row">
        <span class="dim">WebRTC：{{ webrtcStatusText }}</span>
      </div>
      <div class="row">
        <select
          :value="selectedVideoDeviceId"
          @change="selectVideoDevice(($event.target as HTMLSelectElement).value)"
        >
          <option value="">默认摄像头</option>
          <option
            v-for="d in videoDevices"
            :key="d.deviceId"
            :value="d.deviceId"
          >
            {{ d.label }}
          </option>
        </select>
        <button :disabled="videoBusy" @click="refreshVideoDevices">
          刷新设备
        </button>
        <button
          class="primary"
          :disabled="videoBusy"
          @click="previewing ? stopPreview() : startPreview()"
        >
          {{ previewing ? "停止预览" : "本地预览" }}
        </button>
        <span v-if="videoBusy" class="dim">取流中…</span>
        <span v-if="videoError" class="notice error">{{ videoError }}</span>
      </div>
      <video
        v-show="previewing"
        ref="videoEl"
        class="video-preview"
        muted
        autoplay
        playsinline
      />
      <p v-if="videoSettings" class="hint mono">
        实测：{{ videoSettings.width ?? "?" }}×{{ videoSettings.height ?? "?" }}
        @ {{ videoSettings.frameRate !== undefined ? Math.round(videoSettings.frameRate) : "?" }} fps
        · {{ selectedVideoDeviceId || "默认设备" }}
      </p>
    </section>

    <section class="card">
      <h2>唤醒 NS</h2>
      <p class="hint">
        主机休眠时需固件支持 USB 远程唤醒（CMD_WAKE 0x92，
        见 docs/lab-notes/wake-research.md）。当前固件尚未实现，
        手机端按钮会明确提示不支持；请先手动唤醒主机。
      </p>
    </section>
  </div>
</template>

<style scoped>
.remote-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.remote-page h1 {
  margin: 0;
  font-size: 22px;
}

.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 16px;
}

.card h2 {
  margin: 0 0 8px;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 10px 0 0;
}

.hint.firewall {
  margin-top: 12px;
}

.keepalive-row {
  margin-top: 12px;
  align-items: flex-start;
}

.keepalive-row .field {
  min-width: 220px;
}

.keepalive-row .dim {
  flex: 1;
  min-width: 240px;
}

.help-card {
  cursor: pointer;
}

.help-card summary {
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
  cursor: pointer;
}

.help-body {
  margin-top: 10px;
  cursor: default;
}

.help-steps {
  padding-left: 18px;
}

.help-card a {
  color: var(--accent);
}

.state-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.state-dot.on {
  background: var(--ok);
}

.state-dot.off {
  background: var(--text-dim);
  opacity: 0.5;
}

.notice.error {
  color: var(--error);
  font-size: 12px;
}

.qr-row {
  display: flex;
  gap: 16px;
  align-items: center;
}

.qr {
  width: 220px;
  height: 220px;
  border-radius: 8px;
  background: #fff;
}

.qr.placeholder {
  background: var(--border);
}

.url-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
}

.url-side select {
  max-width: 100%;
}

.token {
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  user-select: text;
}

.dim {
  color: var(--text-dim);
  font-size: 12px;
}

.video-preview {
  display: block;
  margin-top: 12px;
  max-width: 480px;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #000;
}

.hint.mono {
  font-family: var(--font-mono, monospace);
}
</style>

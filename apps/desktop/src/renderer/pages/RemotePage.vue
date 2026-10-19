<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import QRCode from "qrcode";
import type { RemoteStatus } from "../../shared/ipc";

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
  const url = status.value?.urls[selectedUrl.value];
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
  const url = status.value?.urls[selectedUrl.value];
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard denied */
  }
}

onMounted(async () => {
  await load();
  offState = window.api.remote.onStateChanged(async (s) => {
    status.value = s;
    if (selectedUrl.value >= s.urls.length) selectedUrl.value = 0;
    await refreshQr();
  });
  clockTimer = window.setInterval(() => (nowTick.value = Date.now()), 1000);
});

onUnmounted(() => {
  offState?.();
  if (clockTimer !== null) window.clearInterval(clockTimer);
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
            <option v-for="(u, i) in status?.urls" :key="u" :value="i">
              {{ u.replace(/^http:\/\//, "").replace(/\?t=.+$/, "") }}
            </option>
          </select>
          <button @click="copyUrl">
            {{ copied ? "已复制" : "复制链接" }}
          </button>
        </div>
      </div>
    </section>

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
</style>

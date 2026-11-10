<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Power } from "lucide-vue-next";
import type { AccelStatus } from "../../shared/ipc";
import AppCard from "../components/ui/AppCard.vue";
import AppButton from "../components/ui/AppButton.vue";
import SectionHeader from "../components/ui/SectionHeader.vue";

const status = ref<AccelStatus | null>(null);
const busy = ref(false);

const running = computed(() => status.value?.serverState === "running");

const serverLine = computed(() => {
  const s = status.value;
  if (!s) return "";
  switch (s.serverState) {
    case "running":
      return `运行中 · 代理端口 ${s.port}`;
    case "starting":
      return "启动中…";
    case "error":
      return s.error ?? "启动失败";
    default:
      return "未运行";
  }
});

function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "—";
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB/s`;
  return `${(kb / 1024).toFixed(1)} MB/s`;
}

function fmtBytes(total: number): string {
  if (total < 1024) return `${total} B`;
  const kb = total / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

async function refresh(): Promise<void> {
  status.value = await window.api.netaccel.getStatus();
}

async function toggleEnabled(): Promise<void> {
  if (!status.value) return;
  busy.value = true;
  try {
    status.value = await window.api.netaccel.setEnabled(!running.value);
  } finally {
    busy.value = false;
  }
}

const disposers: Array<() => void> = [];

onMounted(async () => {
  disposers.push(
    window.api.netaccel.onStateChanged((s) => {
      status.value = s;
    }),
  );
  await refresh();
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <div class="accel-page">
    <h1>网络加速</h1>
    <p class="page-hint">
      在本机运行一个下载转发代理：NS2 的 eShop 下载流量经本机转发，
      自动从延迟最低的 Akamai 边缘节点下载（TLS 端到端，代理不碰证书）。
      <span class="badge">只影响下载与商店，不影响联机对战</span>
    </p>

    <AppCard title="下载转发代理">
      <template #actions>
        <AppButton
          variant="primary"
          :disabled="busy"
          @click="toggleEnabled"
        >
          <Power :size="15" />
          {{ running ? "停止代理" : "启动代理" }}
        </AppButton>
      </template>

      <div class="status-grid">
        <div class="status-item">
          <span class="label">服务状态</span>
          <span :class="running ? 'ok' : status?.serverState === 'error' ? 'err' : 'dim'">
            {{ serverLine }}
          </span>
        </div>
        <div class="status-item">
          <span class="label">活动连接</span>
          <span>{{ status?.connections ?? 0 }}</span>
        </div>
        <div class="status-item">
          <span class="label">累计流量</span>
          <span>{{ fmtBytes(status?.totalBytes ?? 0) }}</span>
        </div>
        <div class="status-item">
          <span class="label">当前速度</span>
          <span>{{ fmtSpeed(status?.bytesPerSec ?? 0) }}</span>
        </div>
      </div>
    </AppCard>

    <AppCard title="NS2 设置方法">
      <p class="hint">
        NS2 的代理设置指向本机后，eShop 下载会经本机转发，
        自动挑选延迟最低的 Akamai 边缘节点。游戏联机流量不走代理。
      </p>
      <div class="proxy-hint">
        <b>NS2 一次性配置</b>：设置 → 互联网 → 已登录网络 → 更改设置 →
        代理服务器 → 手动
        <div class="dns-row">
          <span class="dim">服务器</span>
          <code v-for="ip in status?.lanIps ?? []" :key="ip">{{ ip }}</code>
        </div>
        <div class="dns-row">
          <span class="dim">端口</span>
          <code>{{ status?.port ?? "—" }}</code>
          <span class="dim">认证：无</span>
        </div>
      </div>
      <p class="hint">
        取消代理时，把 NS2 的代理设置改回「不使用」即可。
      </p>
    </AppCard>

    <AppCard title="工作原理">
      <p class="hint">
        启动后本机会对 Nintendo CDN 域名做一轮多 DNS 候选采集
        （阿里 223.5.5.5 / 腾讯 119.29.29.29 并发查询），
        并对每个候选节点做 TCP 连接测速，连通最快的节点自动排在下载路径最前。
        NS2 每次通过代理请求下载时都会使用当前最快的节点。
        下载速度实时显示在上方。
      </p>
    </AppCard>
  </div>
</template>

<style scoped>
.accel-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.accel-page h1 {
  margin: 0;
  font-size: 24px;
}

.page-hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}

.badge {
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
  margin-left: 8px;
}

.status-grid {
  display: flex;
  gap: 16px;
  margin-bottom: 10px;
}

.status-item {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 8px);
  background: var(--surface-raised);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-item .label {
  font-size: 11px;
  color: var(--text-dim);
}

.ok {
  color: var(--ok, #3fb96f);
}

.err {
  color: var(--error, #e0564f);
}

.dim {
  color: var(--text-dim);
}

.proxy-hint {
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 8px);
  background: var(--surface-raised);
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.8;
}

.dns-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

code {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1px 6px;
  font-family: var(--mono, monospace);
  font-size: 12px;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 6px 0;
  line-height: 1.7;
}
</style>

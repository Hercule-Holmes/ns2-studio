<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Power, RefreshCw, Gauge } from "lucide-vue-next";
import type { AccelProgress, AccelStatus } from "../../shared/ipc";
import AppCard from "../components/ui/AppCard.vue";
import AppButton from "../components/ui/AppButton.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import SectionHeader from "../components/ui/SectionHeader.vue";

const status = ref<AccelStatus | null>(null);
const progressLine = ref<string | null>(null);
const busy = ref(false);

const running = computed(() => status.value?.serverState === "running");
const testing = computed(() => status.value?.testState === "running");

const serverLine = computed(() => {
  const s = status.value;
  if (!s) return "";
  switch (s.serverState) {
    case "running":
      return `运行中 · 端口 ${s.port}`;
    case "starting":
      return "启动中…";
    case "error":
      return s.error ?? "启动失败";
    default:
      return "未运行";
  }
});

const PHASE_LABEL: Record<AccelProgress["phase"], string> = {
  collect: "收集候选节点",
  probe: "探测节点延迟",
  verify: "TLS 验证",
  done: "完成",
  error: "出错",
};

function renderProgress(p: AccelProgress): void {
  progressLine.value =
    p.phase === "done" || p.phase === "error"
      ? `${PHASE_LABEL[p.phase]}${p.message ? `：${p.message}` : ""}`
      : `${PHASE_LABEL[p.phase]} ${p.done}/${p.total}`;
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

async function runSpeedtest(): Promise<void> {
  busy.value = true;
  progressLine.value = "测速中…";
  try {
    status.value = await window.api.netaccel.runSpeedtest();
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
    window.api.netaccel.onProgress(renderProgress),
  );
  await refresh();
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
});

function fmtTime(ts: number | null): string {
  return ts === null ? "从未" : new Date(ts).toLocaleTimeString();
}
</script>

<template>
  <div class="accel-page">
    <h1>网络加速</h1>
    <p class="page-hint">
      eShop DNS 优选：PC 测一圈 Nintendo CDN 节点延迟，NS2 的 DNS 指到本机后自动从最快节点下载。
      <span class="badge">只加速内容下载域名，不碰登录与联机</span>
    </p>

    <AppCard title="DNS 优选服务">
      <template #actions>
        <AppButton
          variant="primary"
          :disabled="busy"
          @click="runSpeedtest"
        >
          <Gauge :size="15" />
          {{ status?.lastRunAt ? "重新测速" : "开始测速" }}
        </AppButton>
        <AppButton :disabled="busy" @click="toggleEnabled">
          <Power :size="15" />
          {{ running ? "停止服务" : "启动服务" }}
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
          <span class="label">上次测速</span>
          <span>{{ fmtTime(status?.lastRunAt ?? null) }}</span>
        </div>
        <div class="status-item">
          <span class="label">加速应答 / 转发</span>
          <span>
            {{ status?.queriesAnswered ?? 0 }} / {{ status?.queriesForwarded ?? 0 }}
          </span>
        </div>
      </div>

      <p v-if="progressLine" class="hint progress-line">{{ progressLine }}</p>

      <div v-if="running && status?.ns2DnsIps.length" class="ns2-hint">
        <b>NS2 一次性配置</b>：设置 → 互联网 → 已登录网络 → 更改设置 → DNS 设置 → 手动
        <div class="dns-row">
          主 DNS <code>{{ status.ns2DnsIps[0] }}</code>
          <span class="dim">副 DNS（PC 关机时兜底）</span>
          <code>{{ status.upstreamDns[0] }}</code>
        </div>
        <span class="dim">改完退出 eShop 重新进入生效；副 DNS 保证 PC 关机时主机上网不受影响。</span>
      </div>
    </AppCard>

    <AppCard title="节点排名">
      <EmptyState
        v-if="(status?.domains.length ?? 0) === 0"
        :icon="Gauge"
        title="暂无测速数据"
        hint="启动服务并完成一轮测速后显示各 CDN 节点延迟"
      />
      <div v-for="d in status?.domains ?? []" :key="d.domain" class="domain-block">
        <SectionHeader :title="d.label" />
        <div class="domain-line">
          <code class="domain-name">{{ d.domain }}</code>
          <span v-if="d.best" class="best">当前使用：{{ d.best }}</span>
          <span v-else class="dim">未加速（无通过验证的节点）</span>
        </div>
        <div v-if="d.results.length > 0" class="result-table">
          <div v-for="r in d.results.slice(0, 8)" :key="r.ip" class="result-row" :class="{ best: r.verified }">
            <span>{{ r.ip }}</span>
            <span>{{ r.verified ? "✓ " : "" }}{{ r.rttMs !== null ? r.rttMs + " ms" : "不可达" }}</span>
          </div>
        </div>
      </div>
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

.progress-line {
  margin: 6px 0;
}

.ns2-hint {
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

.domain-block {
  margin-top: 10px;
}

.domain-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 4px 0 8px;
  font-size: 12px;
}

.domain-name {
  word-break: break-all;
}

.best {
  color: var(--ok, #3fb96f);
  font-weight: 600;
}

.result-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-card, 8px);
  overflow: hidden;
}

.result-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid var(--border);
}

.result-row:last-child {
  border-bottom: none;
}

.result-row.best {
  color: var(--ok, #3fb96f);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

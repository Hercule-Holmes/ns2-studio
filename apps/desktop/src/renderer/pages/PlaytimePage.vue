<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { UserPlus, RefreshCw, Trash2, Gamepad2 } from "lucide-vue-next";
import type {
  NintendoAccountView,
  NintendoMergedDay,
  NintendoSyncProgress,
} from "../../shared/ipc";
import AppCard from "../components/ui/AppCard.vue";
import AppButton from "../components/ui/AppButton.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import SectionHeader from "../components/ui/SectionHeader.vue";

const accounts = ref<NintendoAccountView[]>([]);
const days = ref<NintendoMergedDay[]>([]);
const view = ref<"all" | string>("all");
const syncing = ref(false);
const busyAccount = ref<string | null>(null);
const progress = ref<string | null>(null);
const covers = ref<Record<string, string>>({});
const loaded = ref(false);

const visibleDays = computed(() =>
  view.value === "all"
    ? days.value
    : days.value
        .map((day) => ({
          ...day,
          totalSeconds:
            day.perAccount[view.value] ?? 0,
          apps: day.apps
            .map((app) => ({
              ...app,
              totalSeconds: app.perAccount[view.value] ?? 0,
            }))
            .filter((app) => app.totalSeconds > 0),
        }))
        .filter((day) => day.totalSeconds > 0),
);

const totals = computed(() => {
  const days_ = visibleDays.value;
  const sum = (pred: (d: NintendoMergedDay) => boolean) =>
    days_.filter(pred).reduce((acc, d) => acc + d.totalSeconds, 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  return {
    total: sum(() => true),
    today: sum((d) => d.date === todayKey),
    week: sum((d) => d.date >= weekStart.toISOString().slice(0, 10)),
  };
});

const accountName = (sub: string): string =>
  accounts.value.find((a) => a.sub === sub)?.nickname ?? sub;

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分`;
}

async function loadAll(): Promise<void> {
  accounts.value = await window.api.nintendo.accounts();
  days.value = await window.api.nintendo.data();
  // covers for visible apps
  for (const day of days.value) {
    for (const app of day.apps) {
      if (covers.value[app.id] || !app.id) continue;
      try {
        const url = await window.api.nintendo.cover(app.id);
        if (url) covers.value[app.id] = url;
      } catch {
        // cover is optional decoration
      }
    }
  }
  loaded.value = true;
}

async function addAccount(): Promise<void> {
  busyAccount.value = "add";
  try {
    await window.api.nintendo.addAccount();
    await loadAll();
  } catch (err) {
    progress.value = err instanceof Error ? err.message : String(err);
  } finally {
    busyAccount.value = null;
  }
}

async function removeAccount(sub: string): Promise<void> {
  await window.api.nintendo.removeAccount(sub);
  if (view.value === sub) view.value = "all";
  await loadAll();
}

async function sync(sub?: string): Promise<void> {
  syncing.value = true;
  progress.value = null;
  try {
    await window.api.nintendo.sync(sub);
    await loadAll();
    progress.value = "同步完成";
  } finally {
    syncing.value = false;
  }
}

const disposers: Array<() => void> = [];

onMounted(async () => {
  disposers.push(
    window.api.nintendo.onSyncProgress((p) => {
      progress.value = `${accountName(p.sub)}: ${p.phase}${p.message ? " · " + p.message : ""}`;
    }),
    window.api.nintendo.onChanged(() => {
      void loadAll();
    }),
  );
  await loadAll();
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <div class="playtime-page">
    <h1>游玩记录</h1>
    <p class="page-hint">
      数据来自 Nintendo 家长控制服务（只读自己账号的游玩时长与封面）。
      <span class="badge warn">非实机验证版本：API 流程按社区文档实现，字段可能需微调</span>
    </p>

    <AppCard title="账号">
      <template #actions>
        <AppButton :disabled="busyAccount !== null" @click="addAccount">
          <UserPlus :size="15" />
          {{ busyAccount === "add" ? "登录中…" : "添加账号" }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="syncing || accounts.length === 0"
          @click="sync()"
        >
          <RefreshCw :size="15" :class="{ spin: syncing }" />
          同步全部
        </AppButton>
      </template>

      <EmptyState
        v-if="accounts.length === 0"
        :icon="Gamepad2"
        title="尚未添加 Nintendo 账号"
        hint="添加后自动拉取游玩时长与游戏封面（只读自己账号数据）"
      />
      <div v-else class="account-list">
        <div v-for="a in accounts" :key="a.sub" class="account-row">
          <span class="avatar">{{ a.nickname.slice(0, 1) }}</span>
          <span class="nickname">{{ a.nickname }}</span>
          <span class="meta">
            {{ a.lastSyncAt ? "上次同步 " + a.lastSyncAt.slice(0, 16).replace("T", " ") : "未同步" }}
          </span>
          <AppButton
            variant="ghost"
            :disabled="syncing"
            :title="'单独同步该账号'"
            @click="sync(a.sub)"
          >
            <RefreshCw :size="14" />
          </AppButton>
          <AppButton variant="danger" @click="removeAccount(a.sub)">
            <Trash2 :size="14" />
          </AppButton>
        </div>
      </div>
      <p v-if="progress" class="hint progress-line">{{ progress }}</p>
    </AppCard>

    <AppCard title="游玩时长">
      <template #actions>
        <div class="view-chips">
          <button
            class="view-chip"
            :class="{ on: view === 'all' }"
            @click="view = 'all'"
          >
            全部合计
          </button>
          <button
            v-for="a in accounts"
            :key="a.sub"
            class="view-chip"
            :class="{ on: view === a.sub }"
            @click="view = a.sub"
          >
            {{ a.nickname }}
          </button>
        </div>
      </template>

      <EmptyState
        v-if="visibleDays.length === 0"
        :icon="Gamepad2"
        title="暂无游玩数据"
        hint="添加账号并同步后显示"
      />
      <div v-else class="summary-row">
        <div class="summary">
          <span class="num">{{ fmt(totals.total) }}</span>
          <span class="label">合计</span>
        </div>
        <div class="summary">
          <span class="num">{{ fmt(totals.week) }}</span>
          <span class="label">近 7 天</span>
        </div>
        <div class="summary">
          <span class="num">{{ fmt(totals.today) }}</span>
          <span class="label">今日</span>
        </div>
      </div>

      <div v-for="day in visibleDays" :key="day.date" class="day-block">
        <SectionHeader :title="day.date" />
        <div class="total-line">合计 {{ fmt(day.totalSeconds) }}</div>
        <div v-for="app in day.apps" :key="app.id" class="app-row">
          <img
            v-if="covers[app.id]"
            :src="covers[app.id]"
            class="cover"
            alt=""
          />
          <span v-else class="cover cover-missing" />
          <span class="app-name">{{ app.name }}</span>
          <span class="app-time">{{ fmt(app.totalSeconds) }}</span>
          <span v-if="view === 'all'" class="per-account">
            <span v-for="(sec, sub) in app.perAccount" :key="sub" class="chip">
              {{ accountName(sub) }} {{ fmt(sec) }}
            </span>
          </span>
        </div>
      </div>
    </AppCard>
  </div>
</template>

<style scoped>
.playtime-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.playtime-page h1 {
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
}

.badge.warn {
  color: var(--warn);
  border-color: var(--warn);
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.account-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-ctl);
  background: var(--surface-raised);
}

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--brand);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.nickname {
  font-weight: 600;
}

.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin-left: auto;
}

.progress-line {
  margin-top: 8px;
}

.view-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.view-chip {
  padding: 4px 12px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
}

.view-chip.on {
  background: var(--selected-bg);
  color: var(--selected-text);
  border-color: transparent;
  font-weight: 600;
}

.summary-row {
  display: flex;
  gap: 16px;
  margin-bottom: 14px;
}

.summary {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface-raised);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary .num {
  font-size: 20px;
  font-weight: 700;
  color: var(--gold, var(--brand));
}

.summary .label {
  font-size: 11px;
  color: var(--text-dim);
}

.day-block {
  margin-top: 14px;
}

.total-line {
  font-size: 12px;
  color: var(--text-dim);
  margin: 4px 0 8px;
}

.app-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.cover {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  object-fit: cover;
}

.cover-missing {
  background: var(--surface-raised);
  border: 1px solid var(--border);
}

.app-name {
  flex: 1;
}

.app-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.per-account {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 8px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-dim);
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

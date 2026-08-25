<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type {
  AmiiboCapabilities,
  AmiiboItem,
  AmiiboProgress,
  DeviceStatus,
} from "../../shared/ipc";

const SLOT_COUNT = 16;

const items = ref<AmiiboItem[]>([]);
const capabilities = ref<AmiiboCapabilities>({
  amiibo: "unknown",
  connected: false,
});
const status = ref<DeviceStatus>({ state: "disconnected" });
const selectedId = ref<string | null>(null);
const currentSlot = ref<number | null>(null);
const saving = ref(false);
const progress = ref<AmiiboProgress | null>(null);
const notice = ref<{ kind: "ok" | "error"; text: string } | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref("");
const draggingId = ref<string | null>(null);

const disposers: Array<() => void> = [];

const isConnected = computed(() => status.value.state === "connected");
const selectedItem = computed(
  () => items.value.find((i) => i.id === selectedId.value) ?? null,
);

const slots = computed(() =>
  Array.from({ length: SLOT_COUNT }, (_, i) => {
    const item = items.value.find((it) => it.lastSlot === i);
    return { index: i, item: item ?? null };
  }),
);

const capabilityBanner = computed(() => {
  if (!isConnected.value) {
    return {
      kind: "dim",
      text: "未连接设备：写入与切换需先连接串口（设备页）。",
    };
  }
  if (capabilities.value.amiibo === "false") {
    return {
      kind: "error",
      text: "固件不支持 Amiibo（写入时收到 Error 应答）。请更新固件或确认设备能力。",
    };
  }
  if (capabilities.value.amiibo === "true") {
    return { kind: "ok", text: "Amiibo 能力已确认：可写入槽位与切换当前槽位。" };
  }
  return {
    kind: "warn",
    text: "Amiibo 能力未知：可直接尝试写入，失败会给出明确原因。",
  };
});

const canWrite = computed(() => isConnected.value && !saving.value);

async function refresh(): Promise<void> {
  items.value = await window.api.amiibo.list();
  const cap = await window.api.amiibo.getCapabilities();
  capabilities.value = cap;
}

async function importFiles(): Promise<void> {
  const item = await window.api.amiibo.pickAndImport();
  if (item) {
    notice.value = { kind: "ok", text: `已导入 ${item.name}（${item.size} B）` };
    await refresh();
  }
}

function startRename(item: AmiiboItem): void {
  renamingId.value = item.id;
  renameText.value = item.name;
}

async function commitRename(): Promise<void> {
  const id = renamingId.value;
  if (!id) return;
  const name = renameText.value.trim();
  renamingId.value = null;
  if (!name) return;
  try {
    await window.api.amiibo.rename(id, name);
    await refresh();
  } catch (err) {
    notice.value = { kind: "error", text: String(err) };
  }
}

async function removeItem(item: AmiiboItem): Promise<void> {
  const ok = window.confirm(`从库中删除「${item.name}」？`);
  if (!ok) return;
  await window.api.amiibo.remove(item.id);
  if (selectedId.value === item.id) selectedId.value = null;
  await refresh();
}

function selectItem(item: AmiiboItem): void {
  selectedId.value = selectedId.value === item.id ? null : item.id;
}

async function saveToSlot(slot: number, id: string): Promise<void> {
  if (!canWrite.value) return;
  notice.value = null;
  progress.value = { slot, sent: 0, total: 1 };
  saving.value = true;
  try {
    const result = await window.api.amiibo.saveToSlot(slot, id);
    if (result.ok) {
      currentSlot.value = slot;
      notice.value = {
        kind: "ok",
        text: `槽位 ${slot} 写入完成（${result.sent}/${result.total} B）`,
      };
      await refresh();
    } else {
      notice.value = { kind: "error", text: result.message };
    }
  } finally {
    saving.value = false;
    progress.value = null;
  }
}

async function onCellClick(slot: number): Promise<void> {
  if (!canWrite.value) return;
  const id = selectedId.value;
  if (id) {
    await saveToSlot(slot, id);
  } else {
    await changeIndex(slot);
  }
}

async function onDrop(slot: number, ev: DragEvent): Promise<void> {
  ev.preventDefault();
  const id = draggingId.value ?? ev.dataTransfer?.getData("text/plain") ?? null;
  draggingId.value = null;
  if (!id) return;
  const exists = items.value.some((i) => i.id === id);
  if (exists) await saveToSlot(slot, id);
}

async function changeIndex(slot: number): Promise<void> {
  if (!canWrite.value) return;
  notice.value = null;
  const result = await window.api.amiibo.changeIndex(slot);
  if (result.ok) {
    currentSlot.value = slot;
    notice.value = { kind: "ok", text: `已切换当前槽位为 ${slot}` };
  } else {
    notice.value = { kind: "error", text: result.message };
  }
}

function cancelSave(): void {
  void window.api.amiibo.cancel();
}

function onDragStart(item: AmiiboItem, ev: DragEvent): void {
  draggingId.value = item.id;
  ev.dataTransfer?.setData("text/plain", item.id);
}

function pct(sent: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((sent / total) * 100));
}

onMounted(async () => {
  status.value = await window.api.device.getStatus();
  await refresh();
  disposers.push(
    window.api.device.onStateChanged((s) => {
      status.value = s;
    }),
    window.api.amiibo.onCapabilitiesChanged((c) => {
      capabilities.value = c;
    }),
    window.api.amiibo.onProgress((p) => {
      progress.value = p;
    }),
  );
});

onUnmounted(() => {
  for (const dispose of disposers) dispose();
});
</script>

<template>
  <div class="amiibo-page">
    <div class="page-head">
      <h1>Amiibo</h1>
      <span class="slot-current">
        当前槽位：{{ currentSlot ?? "—" }}
      </span>
    </div>

    <div class="banner" :data-kind="capabilityBanner.kind">
      {{ capabilityBanner.text }}
    </div>

    <section class="card">
      <div class="card-head">
        <h2>库</h2>
        <button class="primary" :disabled="!isConnected" @click="importFiles">
          导入 .bin
        </button>
      </div>
      <p class="hint">
        仅作 raw bytes 仓库：不进行任何破解/生成。点击条目选中后点槽位写入，
        或直接把条目拖到槽位；点击空槽位可切换当前槽位。
      </p>
      <ul class="item-list">
        <li
          v-for="item in items"
          :key="item.id"
          class="item"
          :class="{ selected: selectedId === item.id, dragging: draggingId === item.id }"
          draggable="true"
          @dragstart="onDragStart(item, $event)"
          @dragend="draggingId = null"
          @click="selectItem(item)"
        >
          <span v-if="renamingId === item.id" class="item-rename">
            <input
              v-model="renameText"
              autofocus
              @keyup.enter="commitRename"
              @keyup.esc="renamingId = null"
              @click.stop
            />
            <button @click.stop="commitRename">保存</button>
            <button @click.stop="renamingId = null">取消</button>
          </span>
          <template v-else>
            <span class="item-name">{{ item.name }}</span>
            <span class="item-meta">{{ item.size }} B</span>
            <span v-if="item.lastSlot !== undefined" class="item-slot">
              上次槽位 {{ item.lastSlot }}
            </span>
            <span class="item-actions">
              <button class="ghost" title="重命名" @click.stop="startRename(item)">✎</button>
              <button class="ghost" title="删除" @click.stop="removeItem(item)">✕</button>
            </span>
          </template>
        </li>
        <li v-if="items.length === 0" class="empty">库为空：请先导入 .bin dump。</li>
      </ul>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>槽位 0–15</h2>
        <span v-if="selectedItem" class="selected-hint">
          已选：{{ selectedItem.name }}
        </span>
      </div>
      <div class="slot-grid">
        <button
          v-for="slot in slots"
          :key="slot.index"
          class="slot"
          :class="{
            active: currentSlot === slot.index,
            occupied: slot.item !== null,
          }"
          :disabled="!canWrite"
          :data-slot="slot.index"
          @click="onCellClick(slot.index)"
          @dragover.prevent
          @drop="onDrop(slot.index, $event)"
        >
          <span class="slot-index">{{ slot.index }}</span>
          <span v-if="slot.item" class="slot-name">{{ slot.item.name }}</span>
          <span v-else class="slot-empty">空</span>
        </button>
      </div>
    </section>

    <section v-if="saving && progress" class="card progress-card">
      <div class="progress-row">
        <span>正在写入槽位 {{ progress.slot }}…</span>
        <button :disabled="!saving" @click="cancelSave">取消</button>
      </div>
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: pct(progress.sent, progress.total) + '%' }" />
      </div>
      <span class="progress-text">
        {{ progress.sent }} / {{ progress.total }} B（{{ pct(progress.sent, progress.total) }}%）
      </span>
    </section>

    <div v-if="notice" class="notice" :data-kind="notice.kind">
      {{ notice.text }}
    </div>
  </div>
</template>

<style scoped>
.amiibo-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: baseline;
  gap: 16px;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
}

.slot-current {
  color: var(--text-dim);
  font-size: 13px;
}

.banner {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
}

.banner[data-kind="ok"] {
  color: var(--ok);
  border-color: var(--ok);
}

.banner[data-kind="warn"] {
  color: var(--warn);
  border-color: var(--warn);
}

.banner[data-kind="error"] {
  color: var(--error);
  border-color: var(--error);
}

.banner[data-kind="dim"] {
  color: var(--text-dim);
}

.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 16px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.card-head h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0 0 12px;
}

.selected-hint {
  color: var(--accent);
  font-size: 13px;
}

.item-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: grab;
}

.item.selected {
  border-color: var(--accent);
}

.item.dragging {
  opacity: 0.4;
}

.item-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta,
.item-slot {
  color: var(--text-dim);
  font-size: 12px;
  flex-shrink: 0;
}

.item-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}

.item-rename {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.item-rename input {
  flex: 1;
}

.empty {
  color: var(--text-dim);
  font-size: 13px;
  padding: 8px 0;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 10px;
}

.slot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 64px;
  padding: 8px 10px;
  text-align: left;
}

.slot-index {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-dim);
}

.slot-name {
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.slot-empty {
  font-size: 11px;
  color: var(--text-dim);
}

.slot.active {
  border-color: var(--ok);
}

.slot.active .slot-index {
  color: var(--ok);
}

.slot.occupied {
  border-style: dashed;
}

.progress-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress-track {
  height: 8px;
  border-radius: 4px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 120ms linear;
}

.progress-text {
  color: var(--text-dim);
  font-size: 12px;
  margin-top: 6px;
  display: inline-block;
}

.notice {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  border: 1px solid var(--border);
}

.notice[data-kind="ok"] {
  color: var(--ok);
  border-color: var(--ok);
}

.notice[data-kind="error"] {
  color: var(--error);
  border-color: var(--error);
}

.ghost {
  background: transparent;
}
</style>
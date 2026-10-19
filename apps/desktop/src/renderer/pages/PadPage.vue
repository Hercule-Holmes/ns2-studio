<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  STICK_CENTER,
  STICK_MAX,
  SwitchButton,
  SwitchHat,
  buttonToName,
} from "@ns2-studio/pad-types";
import type { DeviceStatus, HubSource } from "../../shared/ipc";
import {
  BUTTON_LABELS,
  HAT_DIRS,
  STICK_VALUES,
  codeLabel,
  defaultKeyMappings,
  hasDuplicateCode,
  mkMapping,
} from "../pad/keymap";
import type { KeyMapping, KeyMapTarget } from "../pad/keymap";
import { stickValueFromPointer, usePadState } from "../pad/use-pad-state";
import RecorderPanel from "../recorder/RecorderPanel.vue";

const SOURCES: Array<{ value: HubSource; label: string }> = [
  { value: "idle", label: "待机 (idle)" },
  { value: "manual", label: "手动 (manual)" },
  { value: "forward", label: "转发 (forward)" },
  { value: "timeline", label: "时间轴 (timeline)" },
  { value: "remote", label: "手机远程 (remote)" },
];

const STICK_TRAVEL = 30;

const status = ref<DeviceStatus>({ state: "disconnected" });
const source = ref<HubSource>("idle");
const windowFocused = ref(true);
const captureOn = ref(true);
const stickHold = ref(false);
const showDebug = ref(false);
const showMapping = ref(false);
const mappings = ref<KeyMapping[]>(defaultKeyMappings());
const editingKeyId = ref<string | null>(null);

const pad = usePadState(() => mappings.value);

const deviceConnected = computed(() => status.value.state === "connected");
const manualActive = computed(
  () => deviceConnected.value && source.value === "manual",
);
const captureActive = computed(
  () => manualActive.value && windowFocused.value && captureOn.value,
);
const sourceLabel = computed(
  () => SOURCES.find((s) => s.value === source.value)?.label ?? source.value,
);

function isButtonDown(bit: number): boolean {
  return (pad.report.value.buttons & bit) !== 0;
}
function isHatDown(dir: number): boolean {
  return pad.report.value.hat === dir;
}

function hatPos(dir: number): Record<string, string> {
  const pos: Record<number, [number, number]> = {
    [SwitchHat.TOP]: [2, 1],
    [SwitchHat.TOP_RIGHT]: [3, 1],
    [SwitchHat.RIGHT]: [3, 2],
    [SwitchHat.BOTTOM_RIGHT]: [3, 3],
    [SwitchHat.BOTTOM]: [2, 3],
    [SwitchHat.BOTTOM_LEFT]: [1, 3],
    [SwitchHat.LEFT]: [1, 2],
    [SwitchHat.TOP_LEFT]: [1, 1],
  };
  const [col, row] = pos[dir] ?? [2, 2];
  return { gridColumn: String(col), gridRow: String(row) };
}

// ------------------------------------------------------------------
// Virtual pad interactions (pointer)
// ------------------------------------------------------------------

function buttonDown(bit: number, e?: Event): void {
  e?.preventDefault();
  if (!manualActive.value) return;
  pad.pressPointerButton(bit);
}
function buttonUp(bit: number): void {
  pad.releasePointerButton(bit);
}
function hatDown(dir: number, e?: Event): void {
  e?.preventDefault();
  if (!manualActive.value) return;
  pad.setPointerHat(dir);
}
function hatUp(): void {
  pad.resetPointerHat();
}

function stickPointerDown(stick: "left" | "right", e: PointerEvent): void {
  if (!manualActive.value) return;
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const { x, y } = stickValueFromPointer(el, e.clientX, e.clientY);
  pad.setStick(stick, x, y);
}
function stickPointerMove(stick: "left" | "right", e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement;
  if (!el.hasPointerCapture(e.pointerId)) return;
  const { x, y } = stickValueFromPointer(el, e.clientX, e.clientY);
  pad.setStick(stick, x, y);
}
function stickPointerUp(stick: "left" | "right", e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement;
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  pad.releaseStick(stick, stickHold.value);
}

function knobStyle(stick: "left" | "right"): Record<string, string> {
  const r = pad.report.value;
  const vx = stick === "left" ? r.lx : r.rx;
  const vy = stick === "left" ? r.ly : r.ry;
  const x = ((vx - STICK_CENTER) / (STICK_MAX - STICK_CENTER)) * STICK_TRAVEL;
  const y = ((vy - STICK_CENTER) / (STICK_MAX - STICK_CENTER)) * STICK_TRAVEL;
  return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` };
}

// ------------------------------------------------------------------
// Keyboard capture (only when manual + focused + capture on)
// ------------------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  if (editingKeyId.value) {
    const m = mappings.value.find((mm) => mm.id === editingKeyId.value);
    if (m && e.code !== "Escape") {
      m.code = e.code;
      m.label = codeLabel(e.code);
    }
    editingKeyId.value = null;
    e.preventDefault();
    return;
  }
  if (!captureActive.value) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (pad.pressKey(e.code)) e.preventDefault();
}
function onKeyUp(e: KeyboardEvent): void {
  pad.releaseKey(e.code);
}
function onWindowBlur(): void {
  windowFocused.value = false;
  pad.resetAll();
}
function onWindowFocus(): void {
  windowFocused.value = true;
}

// ------------------------------------------------------------------
// Source / lifecycle
// ------------------------------------------------------------------

async function setSource(next: HubSource): Promise<void> {
  await window.api.hub.setSource(next);
}

function onHubStateChanged(state: { activeSource: HubSource }): void {
  source.value = state.activeSource;
}

watch(source, (s) => {
  if (s !== "manual") {
    pad.resetAll();
    editingKeyId.value = null;
  }
});

watch(pad.report, (report) => {
  if (manualActive.value) void window.api.pad.apply(report);
});

const disposers: Array<() => void> = [];

onMounted(async () => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);

  disposers.push(
    window.api.device.onStateChanged((s) => {
      status.value = s;
    }),
    window.api.hub.onStateChanged(onHubStateChanged),
  );

  status.value = await window.api.device.getStatus();
  const state = await window.api.hub.getState();
  source.value = state.activeSource;

  if (deviceConnected.value) {
    await window.api.hub.setSource("manual");
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("focus", onWindowFocus);
  for (const dispose of disposers) dispose();
  if (deviceConnected.value) {
    void window.api.hub.setSource("idle");
  }
});

// ------------------------------------------------------------------
// Mapping editor
// ------------------------------------------------------------------

function addMapping(): void {
  const m = mkMapping("", "", { kind: "button", bit: SwitchButton.A });
  mappings.value.push(m);
  editingKeyId.value = m.id;
}
function removeMapping(id: string): void {
  mappings.value = mappings.value.filter((m) => m.id !== id);
}
function restoreDefaults(): void {
  mappings.value = defaultKeyMappings();
  editingKeyId.value = null;
}
function setTargetKind(m: KeyMapping, kind: KeyMapTarget["kind"]): void {
  if (kind === "hat") m.target = { kind, dir: HAT_DIRS[0]!.dir };
  else if (kind === "button") m.target = { kind, bit: BUTTON_LABELS[0]!.bit };
  else m.target = { kind, axis: "x", sign: -1 };
}
function stickValueOf(m: KeyMapping): string {
  const t = m.target;
  return t.kind === "stick" ? `${t.axis}${t.sign < 0 ? "-" : "+"}` : "x-";
}
function setStickValue(m: KeyMapping, value: string): void {
  const opt = STICK_VALUES.find((s) => s.value === value);
  if (opt) m.target = { kind: "stick", axis: opt.axis, sign: opt.sign };
}
function hasDup(): boolean {
  return hasDuplicateCode(mappings.value);
}

const reportText = computed(() => {
  const r = pad.report.value;
  const names = buttonToName(r.buttons).join(" ");
  return (
    `buttons=0x${r.buttons.toString(16).padStart(4, "0")} hat=${r.hat}` +
    ` lx=${r.lx} ly=${r.ly} rx=${r.rx} ry=${r.ry}` +
    (names ? ` [${names}]` : "")
  );
});
</script>

<template>
  <div class="pad-page">
    <div class="page-head">
      <h1>手柄</h1>
      <div class="head-controls">
        <label class="source-select">
          输出源
          <select
            :value="source"
            :disabled="!deviceConnected"
            @change="setSource(($event.target as HTMLSelectElement).value as HubSource)"
          >
            <option v-for="s in SOURCES" :key="s.value" :value="s.value">
              {{ s.label }}
            </option>
          </select>
        </label>
        <span class="status-meta" :data-on="manualActive">
          当前：{{ sourceLabel }}
        </span>
        <label>
          <input v-model="captureOn" type="checkbox" />
          键盘捕获
        </label>
        <label>
          <input v-model="stickHold" type="checkbox" />
          摇杆保持
        </label>
        <span class="status-meta">
          窗口焦点：{{ windowFocused ? "是" : "否" }}
        </span>
      </div>
    </div>

    <RecorderPanel :device-connected="deviceConnected" :source="source" />

    <div v-if="!deviceConnected" class="gate card">
      <p class="hint">
        未连接设备。请在「设备」页连接串口后再使用虚拟手柄（或设置
        <code>NS2_STUDIO_MOCK_SERIAL=1</code> 体验 mock 全流程）。
      </p>
    </div>

    <template v-else>
      <div class="toolbar">
        <button class="ghost" @click="showDebug = !showDebug">
          {{ showDebug ? "收起调试条" : "展开调试条" }}
        </button>
        <button class="ghost" @click="showMapping = !showMapping">
          {{ showMapping ? "收起键位映射" : "编辑键位映射" }}
        </button>
      </div>

      <div v-if="showDebug" class="card debug-bar">
        <span class="mono">{{ reportText }}</span>
      </div>

      <section class="card pad-card" :data-disabled="!manualActive">
        <div class="shoulders">
          <button
            class="pad-btn shoulder"
            :class="{ on: isButtonDown(SwitchButton.L) }"
            @pointerdown="buttonDown(SwitchButton.L, $event)"
            @pointerup="buttonUp(SwitchButton.L)"
            @pointerleave="buttonUp(SwitchButton.L)"
          >
            L
          </button>
          <button
            class="pad-btn shoulder"
            :class="{ on: isButtonDown(SwitchButton.ZL) }"
            @pointerdown="buttonDown(SwitchButton.ZL, $event)"
            @pointerup="buttonUp(SwitchButton.ZL)"
            @pointerleave="buttonUp(SwitchButton.ZL)"
          >
            ZL
          </button>
          <button
            class="pad-btn shoulder"
            :class="{ on: isButtonDown(SwitchButton.ZR) }"
            @pointerdown="buttonDown(SwitchButton.ZR, $event)"
            @pointerup="buttonUp(SwitchButton.ZR)"
            @pointerleave="buttonUp(SwitchButton.ZR)"
          >
            ZR
          </button>
          <button
            class="pad-btn shoulder"
            :class="{ on: isButtonDown(SwitchButton.R) }"
            @pointerdown="buttonDown(SwitchButton.R, $event)"
            @pointerup="buttonUp(SwitchButton.R)"
            @pointerleave="buttonUp(SwitchButton.R)"
          >
            R
          </button>
        </div>

        <div class="pad-body">
          <div class="cluster">
            <div class="hat-grid">
              <button
                v-for="d in HAT_DIRS"
                :key="d.dir"
                class="hat-btn"
                :class="{ on: isHatDown(d.dir) }"
                :style="hatPos(d.dir)"
                @pointerdown="hatDown(d.dir, $event)"
                @pointerup="hatUp"
                @pointerleave="hatUp"
              >
                <span v-if="d.dir === SwitchHat.TOP">↑</span>
                <span v-else-if="d.dir === SwitchHat.TOP_RIGHT">↗</span>
                <span v-else-if="d.dir === SwitchHat.RIGHT">→</span>
                <span v-else-if="d.dir === SwitchHat.BOTTOM_RIGHT">↘</span>
                <span v-else-if="d.dir === SwitchHat.BOTTOM">↓</span>
                <span v-else-if="d.dir === SwitchHat.BOTTOM_LEFT">↙</span>
                <span v-else-if="d.dir === SwitchHat.LEFT">←</span>
                <span v-else>↖</span>
              </button>
              <div class="hat-center">HAT</div>
            </div>

            <div
              class="stick"
              @pointerdown="stickPointerDown('left', $event)"
              @pointermove="stickPointerMove('left', $event)"
              @pointerup="stickPointerUp('left', $event)"
              @pointercancel="stickPointerUp('left', $event)"
            >
              <div class="stick-knob" :style="knobStyle('left')" />
            </div>
            <button
              class="pad-btn small"
              :class="{ on: isButtonDown(SwitchButton.LCLICK) }"
              @pointerdown="buttonDown(SwitchButton.LCLICK, $event)"
              @pointerup="buttonUp(SwitchButton.LCLICK)"
              @pointerleave="buttonUp(SwitchButton.LCLICK)"
            >
              L3
            </button>
          </div>

          <div class="cluster center-cluster">
            <button
              class="pad-btn center"
              :class="{ on: isButtonDown(SwitchButton.CAPTURE) }"
              @pointerdown="buttonDown(SwitchButton.CAPTURE, $event)"
              @pointerup="buttonUp(SwitchButton.CAPTURE)"
              @pointerleave="buttonUp(SwitchButton.CAPTURE)"
            >
              SC
            </button>
            <button
              class="pad-btn center"
              :class="{ on: isButtonDown(SwitchButton.HOME) }"
              @pointerdown="buttonDown(SwitchButton.HOME, $event)"
              @pointerup="buttonUp(SwitchButton.HOME)"
              @pointerleave="buttonUp(SwitchButton.HOME)"
            >
              Home
            </button>
            <button
              class="pad-btn center"
              :class="{ on: isButtonDown(SwitchButton.MINUS) }"
              @pointerdown="buttonDown(SwitchButton.MINUS, $event)"
              @pointerup="buttonUp(SwitchButton.MINUS)"
              @pointerleave="buttonUp(SwitchButton.MINUS)"
            >
              −
            </button>
            <button
              class="pad-btn center"
              :class="{ on: isButtonDown(SwitchButton.PLUS) }"
              @pointerdown="buttonDown(SwitchButton.PLUS, $event)"
              @pointerup="buttonUp(SwitchButton.PLUS)"
              @pointerleave="buttonUp(SwitchButton.PLUS)"
            >
              +
            </button>
          </div>

          <div class="cluster">
            <div class="diamond">
              <button
                class="pad-btn face b-y"
                :class="{ on: isButtonDown(SwitchButton.Y) }"
                @pointerdown="buttonDown(SwitchButton.Y, $event)"
                @pointerup="buttonUp(SwitchButton.Y)"
                @pointerleave="buttonUp(SwitchButton.Y)"
              >
                Y
              </button>
              <button
                class="pad-btn face b-x"
                :class="{ on: isButtonDown(SwitchButton.X) }"
                @pointerdown="buttonDown(SwitchButton.X, $event)"
                @pointerup="buttonUp(SwitchButton.X)"
                @pointerleave="buttonUp(SwitchButton.X)"
              >
                X
              </button>
              <button
                class="pad-btn face b-a"
                :class="{ on: isButtonDown(SwitchButton.A) }"
                @pointerdown="buttonDown(SwitchButton.A, $event)"
                @pointerup="buttonUp(SwitchButton.A)"
                @pointerleave="buttonUp(SwitchButton.A)"
              >
                A
              </button>
              <button
                class="pad-btn face b-b"
                :class="{ on: isButtonDown(SwitchButton.B) }"
                @pointerdown="buttonDown(SwitchButton.B, $event)"
                @pointerup="buttonUp(SwitchButton.B)"
                @pointerleave="buttonUp(SwitchButton.B)"
              >
                B
              </button>
            </div>

            <div
              class="stick"
              @pointerdown="stickPointerDown('right', $event)"
              @pointermove="stickPointerMove('right', $event)"
              @pointerup="stickPointerUp('right', $event)"
              @pointercancel="stickPointerUp('right', $event)"
            >
              <div class="stick-knob" :style="knobStyle('right')" />
            </div>
            <button
              class="pad-btn small"
              :class="{ on: isButtonDown(SwitchButton.RCLICK) }"
              @pointerdown="buttonDown(SwitchButton.RCLICK, $event)"
              @pointerup="buttonUp(SwitchButton.RCLICK)"
              @pointerleave="buttonUp(SwitchButton.RCLICK)"
            >
              R3
            </button>
          </div>
        </div>

        <p v-if="!manualActive" class="pad-disabled-hint">
          输出源非 manual 或未聚焦，虚拟垫与键盘未生效。
        </p>
      </section>

      <section v-if="showMapping" class="card mapping-card">
        <div class="mapping-head">
          <h2>键位映射</h2>
          <div class="mapping-actions">
            <span v-if="hasDup()" class="warn-text">存在重复按键</span>
            <button @click="addMapping">新增映射</button>
            <button @click="restoreDefaults">恢复默认</button>
          </div>
        </div>
        <table class="mapping-table">
          <thead>
            <tr>
              <th>按键</th>
              <th>动作</th>
              <th>值</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in mappings" :key="m.id">
              <td>
                <button class="ghost key-edit" @click="editingKeyId = m.id">
                  {{ editingKeyId === m.id ? "按任意键…" : codeLabel(m.code) }}
                </button>
              </td>
              <td>
                <select
                  :value="m.target.kind"
                  @change="setTargetKind(m, ($event.target as HTMLSelectElement).value as KeyMapTarget['kind'])"
                >
                  <option value="button">按钮</option>
                  <option value="hat">HAT</option>
                  <option value="stick">左摇杆</option>
                </select>
              </td>
              <td>
                <select
                  v-if="m.target.kind === 'button'"
                  :value="m.target.bit"
                  @change="m.target = { kind: 'button', bit: Number(($event.target as HTMLSelectElement).value) }"
                >
                  <option v-for="b in BUTTON_LABELS" :key="b.bit" :value="b.bit">
                    {{ b.label }}
                  </option>
                </select>
                <select
                  v-else-if="m.target.kind === 'hat'"
                  :value="m.target.dir"
                  @change="m.target = { kind: 'hat', dir: Number(($event.target as HTMLSelectElement).value) }"
                >
                  <option v-for="d in HAT_DIRS" :key="d.dir" :value="d.dir">
                    {{ d.label }}
                  </option>
                </select>
                <select
                  v-else
                  :value="stickValueOf(m)"
                  @change="setStickValue(m, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="s in STICK_VALUES" :key="s.value" :value="s.value">
                    {{ s.label }}
                  </option>
                </select>
              </td>
              <td>
                <button @click="removeMapping(m.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pad-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.page-head h1 {
  margin: 0;
  font-size: 22px;
}

.head-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
}

.source-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.status-meta {
  color: var(--text-dim);
  font-size: 13px;
}

.status-meta[data-on="true"] {
  color: var(--ok);
}

.card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 16px;
}

.gate {
  display: flex;
  align-items: center;
}

.hint {
  color: var(--text-dim);
  font-size: 13px;
  margin: 0;
}

.toolbar {
  display: flex;
  gap: 8px;
}

.ghost {
  background: transparent;
}

.debug-bar {
  font-family: var(--mono);
  font-size: 12px;
  padding: 10px 14px;
}

.mono {
  font-family: var(--mono);
}

.pad-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;
  align-items: center;
  padding: 20px;
}

.pad-card[data-disabled="true"] .pad-btn,
.pad-card[data-disabled="true"] .stick,
.pad-card[data-disabled="true"] .hat-btn {
  opacity: 0.55;
  cursor: default;
}

.shoulders {
  display: flex;
  gap: 12px;
}

.pad-body {
  display: flex;
  gap: 64px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.cluster {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.center-cluster {
  flex-direction: row;
  gap: 10px;
}

.pad-btn {
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 700;
  user-select: none;
  touch-action: none;
}

.pad-btn.on {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
  box-shadow: 0 0 10px var(--accent);
}

.pad-btn.shoulder {
  width: 64px;
  height: 34px;
  border-radius: 8px;
  font-size: 13px;
}

.pad-btn.face {
  width: 54px;
  height: 54px;
  font-size: 18px;
}

.pad-btn.face.b-y {
  border-color: #b9a43a;
  color: #f4c542;
}
.pad-btn.face.b-x {
  border-color: #3b6fd6;
  color: #7fb0ff;
}
.pad-btn.face.b-a {
  border-color: #2ea375;
  color: #5fe0ab;
}
.pad-btn.face.b-b {
  border-color: #c24545;
  color: #ff8a8a;
}
.pad-btn.face.on {
  color: #fff;
  border-color: transparent;
  box-shadow: 0 0 12px var(--accent);
}

.pad-btn.small {
  width: 40px;
  height: 40px;
  font-size: 11px;
}

.pad-btn.center {
  width: 40px;
  height: 40px;
  font-size: 15px;
  border-radius: 10px;
}

.diamond {
  display: grid;
  grid-template-columns: repeat(3, 58px);
  grid-template-rows: repeat(3, 58px);
  gap: 4px;
}

.diamond .b-y {
  grid-column: 2;
  grid-row: 1;
}
.diamond .b-x {
  grid-column: 1;
  grid-row: 2;
}
.diamond .b-a {
  grid-column: 3;
  grid-row: 2;
}
.diamond .b-b {
  grid-column: 2;
  grid-row: 3;
}

.hat-grid {
  display: grid;
  grid-template-columns: repeat(3, 46px);
  grid-template-rows: repeat(3, 46px);
  gap: 4px;
  position: relative;
}

.hat-btn {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  font-size: 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-dim);
  user-select: none;
  touch-action: none;
}

.hat-btn.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  box-shadow: 0 0 8px var(--accent);
}

.hat-center {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--text-dim);
}

.stick {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #2a2f3c, #171a21);
  border: 1px solid var(--border);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.stick-knob {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #3a4150;
  border: 1px solid var(--accent-dim);
  position: relative;
  left: 50%;
  top: 50%;
  margin-left: -22px;
  margin-top: -22px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  transition: transform 60ms linear;
}

.pad-disabled-hint {
  margin: 0;
  color: var(--warn);
  font-size: 12px;
}

.mapping-card {
  padding: 14px;
}

.mapping-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.mapping-head h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.mapping-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.warn-text {
  color: var(--warn);
  font-size: 12px;
}

.mapping-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.mapping-table th,
.mapping-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}

.mapping-table th {
  color: var(--text-dim);
  font-weight: 500;
}

.key-edit {
  min-width: 90px;
  font-family: var(--mono);
}
</style>
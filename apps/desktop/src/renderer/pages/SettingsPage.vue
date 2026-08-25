<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AppConfig, AppInfo } from "../../shared/ipc";

const BAUD_OPTIONS = [9600, 115200];

const config = ref<AppConfig | null>(null);
const appInfo = ref<AppInfo | null>(null);
const saved = ref(false);
const saveError = ref<string | null>(null);
const loaded = ref(false);

const serialIntervalMs = ref(2);
const serialBaud = ref(115200);
const captureTickHz = ref(250);
const captureTriggerThreshold = ref(128);
const captureSwapABXY = ref(false);
const timelineGridMs = ref(10);

async function load(): Promise<void> {
  config.value = await window.api.config.get();
  appInfo.value = await window.api.appInfo.getInfo();
  serialIntervalMs.value = config.value.serial.minIntervalMs;
  serialBaud.value = config.value.serial.baud;
  captureTickHz.value = config.value.capture.tickHz;
  captureTriggerThreshold.value = config.value.capture.triggerThreshold;
  captureSwapABXY.value = config.value.capture.swapABXY;
  timelineGridMs.value = config.value.timeline.gridMs;
  loaded.value = true;
}

async function save(): Promise<void> {
  saved.value = false;
  saveError.value = null;
  try {
    await window.api.config.update({
      serial: {
        baud: serialBaud.value,
        minIntervalMs: serialIntervalMs.value,
      },
      capture: {
        tickHz: captureTickHz.value,
        triggerThreshold: captureTriggerThreshold.value,
        swapABXY: captureSwapABXY.value,
      },
      timeline: {
        gridMs: timelineGridMs.value,
      },
    });
    saved.value = true;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err);
  }
}

onMounted(load);
</script>

<template>
  <div class="settings-page">
    <h1>设置</h1>

    <section class="card">
      <h2>串口</h2>
      <p class="hint">
        串口写入间隔越小延迟越低；波特率需与固件一致（默认 115200）。
        修改串口间隔后需重新连接设备生效。
      </p>
      <div class="row">
        <label class="field">
          <span>写入间隔 (minIntervalMs)</span>
          <input v-model.number="serialIntervalMs" type="number" min="0" />
        </label>
        <label class="field">
          <span>波特率</span>
          <select v-model.number="serialBaud">
            <option v-for="b in BAUD_OPTIONS" :key="b" :value="b">{{ b }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="card">
      <h2>采集转发 (NS2 Pro)</h2>
      <p class="hint">
        转发采样率（tickHz）与扳机判定阈值（triggerThreshold，摇杆中立为
        128）；swap ABXY 开启时 L/R 按键位互换。
      </p>
      <div class="row">
        <label class="field">
          <span>轮询 Hz</span>
          <input v-model.number="captureTickHz" type="number" min="1" />
        </label>
        <label class="field">
          <span>舵机阈值 (triggerThreshold)</span>
          <input v-model.number="captureTriggerThreshold" type="number" min="0" max="255" />
        </label>
        <label class="field checkbox">
          <input v-model="captureSwapABXY" type="checkbox" />
          <span>swap ABXY</span>
        </label>
      </div>
    </section>

    <section class="card">
      <h2>时间轴</h2>
      <p class="hint">新工程默认网格（吸附步长，ms）。</p>
      <div class="row">
        <label class="field">
          <span>网格 (gridMs)</span>
          <input v-model.number="timelineGridMs" type="number" min="1" />
        </label>
      </div>
    </section>

    <section class="card">
      <h2>关于</h2>
      <p class="about-name">{{ appInfo?.name ?? "NS2 Studio" }}</p>
      <p class="hint">版本 {{ appInfo?.version ?? "—" }}</p>
      <p class="hint">
        协议兼容开源项目 EasyCon（伊机控），本应用为独立实现，不嵌入其
        .NET 代码。固件刷写请见根目录 README。
      </p>
    </section>

    <div class="actions">
      <button class="primary" :disabled="!loaded" @click="save">保存</button>
      <span v-if="saved" class="notice ok">已保存到 userData/config.json</span>
      <span v-else-if="saveError" class="notice error">保存失败：{{ saveError }}</span>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-page h1 {
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
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
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

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
}

.hint {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0 0 10px;
}

.about-name {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.notice {
  font-size: 12px;
}

.notice.ok {
  color: var(--ok);
}

.notice.error {
  color: var(--error);
}
</style>
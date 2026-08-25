<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  commit: (value: number) => boolean;
}>();

const local = ref(props.value);

watch(
  () => props.value,
  (v) => {
    local.value = v;
  },
);

function onCommit(): void {
  const n = Number(local.value);
  if (!Number.isFinite(n)) {
    local.value = props.value;
    return;
  }
  const step = props.step ?? 1;
  const rounded = Math.round(n / step) * step;
  const ok = props.commit(rounded);
  if (!ok) local.value = props.value;
}
</script>

<template>
  <label class="nf">
    <span>{{ label }}</span>
    <input
      type="number"
      :step="step ?? 1"
      :min="min"
      :max="max"
      :disabled="disabled"
      v-model.number="local"
      @change="onCommit"
      @keydown.enter="onCommit"
    />
  </label>
</template>

<style scoped>
.nf {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
.nf input {
  width: 100%;
}
</style>
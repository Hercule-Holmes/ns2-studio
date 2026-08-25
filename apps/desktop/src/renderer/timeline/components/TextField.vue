<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  label: string;
  value: string;
  disabled?: boolean;
  commit: (value: string) => boolean;
}>();

const local = ref(props.value);

watch(
  () => props.value,
  (v) => {
    local.value = v;
  },
);

function onCommit(): void {
  const ok = props.commit(local.value);
  if (!ok) local.value = props.value;
}
</script>

<template>
  <label class="tf">
    <span>{{ label }}</span>
    <input :value="local" :disabled="disabled" @change="onCommit" @keydown.enter="onCommit" />
  </label>
</template>

<style scoped>
.tf {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
.tf input {
  width: 100%;
}
</style>
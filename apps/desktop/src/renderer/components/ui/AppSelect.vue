<script setup lang="ts">
// S18: labeled select with typed options. modelValue matches the option value.
export interface AppSelectOption {
  value: string | number;
  label: string;
}

const props = defineProps<{
  modelValue: string | number;
  options: AppSelectOption[];
  label?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string | number] }>();

function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value;
  const hit = props.options.find((o) => String(o.value) === raw);
  emit("update:modelValue", hit ? hit.value : raw);
}
</script>

<template>
  <label class="app-field">
    <span v-if="label" class="label">{{ label }}</span>
    <select :value="String(modelValue)" :disabled="disabled" @change="onChange">
      <option v-for="o in options" :key="o.value" :value="String(o.value)">
        {{ o.label }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.app-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.label {
  color: var(--text-dim);
  font-size: 12px;
}

select {
  min-width: 120px;
}
</style>

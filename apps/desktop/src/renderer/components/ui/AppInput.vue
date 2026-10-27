<script setup lang="ts">
// S18: labeled numeric/text input. v-model is number-typed when `type="number"`.
const props = withDefaults(
  defineProps<{
    modelValue: number | string;
    label?: string;
    type?: string;
    min?: number;
    max?: number;
    disabled?: boolean;
  }>(),
  { type: "text", label: "", min: undefined, max: undefined, disabled: false },
);

const emit = defineEmits<{ "update:modelValue": [value: number | string] }>();

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (props.type === "number") {
    const n = Number(raw);
    emit("update:modelValue", Number.isFinite(n) ? n : 0);
  } else {
    emit("update:modelValue", raw);
  }
}
</script>

<template>
  <label class="app-field">
    <span v-if="label" class="label">{{ label }}</span>
    <input
      :type="type"
      :value="modelValue"
      :min="min"
      :max="max"
      :disabled="disabled"
      @input="onInput"
    />
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

input {
  width: 100%;
  min-width: 90px;
}
</style>

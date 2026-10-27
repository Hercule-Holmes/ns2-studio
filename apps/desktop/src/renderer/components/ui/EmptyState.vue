<script setup lang="ts">
import type { Component } from "vue";

// S18: empty/loading placeholder with an optional lucide icon.
withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    hint?: string;
  }>(),
  { hint: "", icon: undefined },
);
</script>

<template>
  <div class="empty">
    <component :is="icon" v-if="icon" class="icon" />
    <div class="title">{{ title }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
}

.icon {
  width: 32px;
  height: 32px;
  color: var(--text-dim);
  opacity: 0.7;
}

.title {
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.hint {
  font-size: 12px;
  color: var(--text-dim);
}
</style>

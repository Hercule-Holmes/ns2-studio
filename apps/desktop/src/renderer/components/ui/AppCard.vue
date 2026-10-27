<script setup lang="ts">
// S18: section card with optional title + actions row (Switch-style rounded
// surface).
withDefaults(defineProps<{ title?: string; flush?: boolean }>(), {
  title: "",
  flush: false,
});
</script>

<template>
  <section class="app-card" :class="{ flush }">
    <div v-if="title || $slots.actions" class="head">
      <h2>{{ title }}</h2>
      <div v-if="$slots.actions" class="actions">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.app-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--surface);
  padding: 16px;
}

.app-card.flush {
  padding: 0;
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.head:last-child {
  margin-bottom: 0;
}

h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>

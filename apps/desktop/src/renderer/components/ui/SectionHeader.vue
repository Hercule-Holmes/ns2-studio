<script setup lang="ts">
// S18: section header row — title on the left, actions on the right.
defineProps<{ title: string }>();
</script>

<template>
  <div class="section-header">
    <h2>{{ title }}</h2>
    <div v-if="$slots.actions" class="actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  margin: 0;
  font-size: 14px;
  color: var(--text-dim);
  font-weight: 600;
}
</style>

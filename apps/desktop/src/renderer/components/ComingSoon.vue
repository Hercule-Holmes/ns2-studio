<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <div class="coming-soon">
    <h2>{{ title }}</h2>
    <p>即将到来 — 该模块将在后续 Session 中实现。</p>
  </div>
</template>

<style scoped>
.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 320px;
  color: var(--text-dim);
}

.coming-soon h2 {
  color: var(--text);
  margin-bottom: 8px;
}
</style>
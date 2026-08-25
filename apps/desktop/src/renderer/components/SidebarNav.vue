<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { NAV_ITEMS } from "../router";

const route = useRoute();
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">NS2</span>
      <span class="brand-name">Studio</span>
    </div>
    <nav class="nav">
      <RouterLink
        v-for="item in NAV_ITEMS"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: route.path === item.path }"
      >
        {{ item.title }}
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid var(--border);
}

.brand-mark {
  color: var(--accent);
  font-weight: 700;
  font-size: 18px;
}

.brand-name {
  color: var(--text-dim);
  font-size: 14px;
}

.nav {
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 4px;
}

.nav-item {
  display: block;
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--text-dim);
  text-decoration: none;
  font-size: 13px;
}

.nav-item:hover {
  color: var(--text);
  background: var(--bg-elevated);
}

.nav-item.active {
  color: var(--accent);
  background: var(--bg-elevated);
}
</style>
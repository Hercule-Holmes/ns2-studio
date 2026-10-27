<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { Gamepad2 } from "lucide-vue-next";
import { NAV_ITEMS } from "../router";

const route = useRoute();
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><Gamepad2 :size="20" /></span>
      <span class="brand-name">NS2 Studio</span>
    </div>
    <nav class="nav">
      <RouterLink
        v-for="item in NAV_ITEMS"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        :class="{ active: route.path === item.path }"
      >
        <component :is="item.icon" class="icon" :size="17" />
        <span>{{ item.title }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 190px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid var(--border);
}

.brand-mark {
  color: var(--brand);
  display: inline-flex;
}

.brand-name {
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
}

.nav {
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--radius-pill);
  color: var(--text-dim);
  text-decoration: none;
  font-size: 13px;
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-item .icon {
  flex-shrink: 0;
}

.nav-item:hover {
  color: var(--text);
  background: var(--surface-raised);
}

/* Switch signature: the selected item inverts to a light pill (dark text);
   in the light theme it inverts to a dark pill (light text). */
.nav-item.active {
  background: var(--selected-bg);
  color: var(--selected-text);
  font-weight: 600;
}
</style>

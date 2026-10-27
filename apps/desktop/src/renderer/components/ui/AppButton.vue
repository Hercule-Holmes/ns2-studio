<script setup lang="ts">
// S18: capsule button, Switch-style. Variants: primary (brand fill) / danger /
// ghost (transparent) / default (raised surface). Attrs (disabled, click, …)
// fall through to the native button via single-root inheritance.
withDefaults(defineProps<{ variant?: "default" | "primary" | "ghost" | "danger" }>(), {
  variant: "default",
});
</script>

<template>
  <button class="app-btn" :class="variant">
    <slot />
  </button>
</template>

<style scoped>
.app-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.app-btn.danger {
  color: var(--error);
  border-color: var(--error);
  background: transparent;
}

.app-btn.danger:hover:not(:disabled) {
  background: var(--error);
  color: #fff;
}

.app-btn :deep(svg) {
  width: 15px;
  height: 15px;
}
</style>

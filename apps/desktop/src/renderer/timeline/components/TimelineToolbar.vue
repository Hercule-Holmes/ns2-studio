<script setup lang="ts">
import { computed } from "vue";
import { timelineStore } from "../store";

const props = defineProps<{ readonly?: boolean }>();

const store = timelineStore;

const title = computed(() => store.project.name || "未命名工程");
const dirtyMark = computed(() => (store.dirty ? "●" : ""));

const emit = defineEmits<{
  newProject: [];
  open: [];
  save: [];
}>();

const canPaste = computed(() => store.selectedIds.length > 0);
</script>

<template>
  <div class="tl-toolbar">
    <div class="group">
      <button class="primary" :disabled="readonly" @click="emit('newProject')">新建</button>
      <button :disabled="readonly" @click="emit('open')">打开</button>
      <button :disabled="readonly" @click="emit('save')">保存</button>
    </div>
    <div class="group">
      <button :disabled="readonly || store.undoDepth === 0" title="撤销 (Ctrl+Z)" @click="store.undo()">
        ⟲ 撤销
      </button>
      <button :disabled="readonly || store.redoDepth === 0" title="重做 (Ctrl+Y)" @click="store.redo()">
        ⟳ 重做
      </button>
      <button :disabled="readonly || !canPaste" title="复制选中片段 (Ctrl+C)，再用 Ctrl+V 在播放头处粘贴" @click="store.copySelected()">
        复制
      </button>
    </div>
    <div class="group title">
      <span class="name">{{ title }}</span>
      <span class="dirty">{{ dirtyMark }}</span>
      <span class="status">{{ store.statusText }}</span>
    </div>
  </div>
</template>

<style scoped>
.tl-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}
.group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.title {
  flex: 1;
  min-width: 0;
}
.name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dirty {
  color: var(--accent);
}
.status {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
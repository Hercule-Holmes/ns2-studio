import { ref } from "vue";
import type { AppSettings } from "../../shared/ipc";

// S18: theme state applied via <html data-theme>; persisted in settings.json
// (AppSettings.theme) through the existing settings:get/update IPC.
export type Theme = NonNullable<AppSettings["theme"]>;

const current = ref<Theme>("dark");

export function applyTheme(theme: Theme): void {
  current.value = theme;
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  return { current, applyTheme };
}

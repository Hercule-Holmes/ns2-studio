import { reactive } from "vue";
import type { RendererApi } from "../shared/ipc";

export interface RendererErrorState {
  message: string;
  stack?: string;
  count: number;
}

/** Reactive error state consumed by the global overlay in App.vue. */
export const rendererError = reactive<RendererErrorState>({
  message: "",
  stack: undefined,
  count: 0,
});

declare global {
  interface Window {
    api: RendererApi;
  }
}

/**
 * Global renderer error boundary (S11). Records the error for the full-screen
 * overlay and forwards it to the main-process crash log (userData/logs).
 */
export function reportRendererError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  rendererError.message = message;
  rendererError.stack = stack;
  rendererError.count += 1;

  const detail = stack ?? message;
  try {
    void window.api?.appInfo?.reportError?.(detail);
  } catch {
    /* best-effort */
  }
}

export function dismissRendererError(): void {
  rendererError.message = "";
  rendererError.stack = undefined;
}
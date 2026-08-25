/**
 * Log stream IPC channels (Main -> Renderer push, plus replay subscribe).
 */
export const LogChannels = {
  subscribe: "log:subscribe",
  line: "log:line",
  /** Renderer -> Main: forward a renderer-side error to the crash log file. */
  reportError: "log:reportError",
} as const;
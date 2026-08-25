/**
 * NS2 Pro capture IPC channels (S8).
 */
export const CaptureChannels = {
  list: "capture:list",
  start: "capture:start",
  stop: "capture:stop",
  getStatus: "capture:getStatus",
  stateChanged: "capture:stateChanged",
} as const;
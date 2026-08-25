/**
 * Recording IPC channels (S7). The main-process Recorder captures the report
 * stream the InputHub actually dispatches, and saves/loads .nsrec.json files.
 */
export const RecorderChannels = {
  start: "recorder:start",
  stop: "recorder:stop",
  reset: "recorder:reset",
  getState: "recorder:getState",
  stateChanged: "recorder:stateChanged",
  save: "recorder:save",
  open: "recorder:open",
} as const;
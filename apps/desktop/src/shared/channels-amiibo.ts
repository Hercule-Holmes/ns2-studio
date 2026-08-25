/**
 * Amiibo IPC channels (S9). Aggregated in `channels.ts`.
 */
export const AmiiboChannels = {
  list: "amiibo:list",
  pickAndImport: "amiibo:pickAndImport",
  rename: "amiibo:rename",
  remove: "amiibo:remove",
  capabilities: "amiibo:capabilities",
  capabilitiesChanged: "amiibo:capabilitiesChanged",
  saveToSlot: "amiibo:saveToSlot",
  changeIndex: "amiibo:changeIndex",
  cancel: "amiibo:cancel",
  progress: "amiibo:progress",
} as const;
/**
 * InputHub arbitration IPC channels (S3).
 */
export const HubChannels = {
  setSource: "hub:setSource",
  getState: "hub:getState",
  forceNeutral: "hub:forceNeutral",
  stateChanged: "hub:stateChanged",
} as const;
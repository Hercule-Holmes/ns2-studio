/**
 * Device IPC channels. One file per domain; aggregated in `channels.ts`.
 */
export const DeviceChannels = {
  listPorts: "device:listPorts",
  connect: "device:connect",
  disconnect: "device:disconnect",
  getStatus: "device:getStatus",
  sendNeutral: "device:sendNeutral",
  sendReport: "device:sendReport",
  wake: "device:wake",
  stateChanged: "device:stateChanged",
} as const;
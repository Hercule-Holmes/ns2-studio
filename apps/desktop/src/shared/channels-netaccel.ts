/**
 * S21 v2: netaccel channels — LAN download proxy for the Switch
 * (replaces the v1 DNS-hijack + speedtest approach).
 */
export const AccelChannels = {
  getStatus: "accel:getStatus",
  setEnabled: "accel:setEnabled",
  start: "accel:start",
  stop: "accel:stop",
  /** M→R: proxy lifecycle / connection / throughput changes */
  stateChanged: "accel:stateChanged",
} as const;

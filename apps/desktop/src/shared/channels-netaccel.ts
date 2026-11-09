/**
 * S21: netaccel (eShop DNS 优选加速) IPC channels.
 */
export const AccelChannels = {
  getStatus: "accel:getStatus",
  setEnabled: "accel:setEnabled",
  start: "accel:start",
  stop: "accel:stop",
  runSpeedtest: "accel:runSpeedtest",
  /** M→R: server lifecycle / speedtest table changes */
  stateChanged: "accel:stateChanged",
  /** M→R: speedtest phase progress */
  progress: "accel:progress",
} as const;

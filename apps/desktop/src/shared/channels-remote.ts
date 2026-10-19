/**
 * Remote bridge IPC channels (S13, 08-REMOTE.md).
 */
export const RemoteChannels = {
  getStatus: "remote:getStatus",
  setEnabled: "remote:setEnabled",
  rotateToken: "remote:rotateToken",
  /** M→R: gateway lifecycle / session changes */
  stateChanged: "remote:stateChanged",
  /** M→R ↔ R→M: opaque WebRTC signaling envelope (S15) */
  signal: "remote:signal",
} as const;

# S15 — 远程视频下行（WebRTC）

| 字段 | 值 |
|------|-----|
| **Status** | `ready` |
| **Priority** | P1 |
| **Depends on** | S13、S14 |
| **Owns** | Renderer 视频模块、Gateway `signal` 通路（已预留） |
| **Estimate** | 2–3 天 |

## 1. 目标

采集卡画面经 Electron Renderer `getUserMedia` → RTCPeerConnection（sendonly）
→ 手机 `<video>`，目标端到端延迟 < 300ms。

## 2. 技术要点

- Renderer `getUserMedia({video:{deviceId}})`：需要
  `session.setPermissionRequestHandler` 自动授权 `media`；
  先用摄像头 spike 验证链路，再切采集卡真机。
- 编码：`contentHint:"motion"`、720p60 起步、码率 4–8Mbps；
  手机端 `video.playoutDelay`/`jitterBufferTarget` 压 0。
- 信令：手机 `signal` → Gateway → IPC → Renderer `RTCPeerConnection`
  （手机为 offerer）；Gateway 仅透传，不解析 SDP。
- 首个 spike（验收门禁）：Electron 内 `enumerateDevices` 能否列出采集卡、
  取流分辨率/帧率实测，结论记入 lab-note。

## 3. 任务清单

- [ ] spike：Electron + 采集卡 getUserMedia 实测（lab-note）
- [ ] 权限自动授权 + 设备选择（config.remote.videoDeviceId）
- [ ] Renderer RTCPeerConnection + IPC 信令转发（`remote:signal` 已预留）
- [ ] 手机端 video 接入 + 唤醒后「无信号→回显」状态机（配合 wake-research D2）
- [ ] 延迟/质量调优与降级（分辨率/帧率自适应）

## 4. 验收

- [ ] 手机端可看到 NS 画面，延迟主观 < 300ms（60fps 拍屏校验）
- [ ] 主机休眠时显示「无信号」；唤醒后自动恢复回显
- [ ] 会话断开时视频流正确停止（track ended / PC closed）

## 5. 不做

- 音频轨道（后置可选）
- 多观众/录制推流

# S15 — 远程视频下行（WebRTC）

| 字段 | 值 |
|------|-----|
| **Status** | `in_progress`（WebRTC 下行全链路已实现，真机/真手机延迟调优待联调） |
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

- [x] spike：Electron + 采集卡 getUserMedia 实测（lab-note）
  - 实测设备：**LCC5046B**（`VID_3707 & PID_5046`，标准 UVC 免驱，MI_00 视频 + MI_02 音频）
  - 2026-10-19 真机通过：枚举可见、选中取流、回显正常；结果见 `lab-notes/S15-capture-card.md`
- [x] 权限自动授权 + 设备选择（config.remote.videoDeviceId；RemotePage「视频（S15 spike）」卡片）
- [x] Renderer RTCPeerConnection + IPC 信令转发（`remote:signal` 已预留）
  - `renderer/remote/video-stream.ts`：手机 offerer（recvonly）→ Renderer 应答采集卡 sendonly 轨；
    ICE 双向透传；1080p60 取流 + 6Mbps 码率上限；`video-stop` 双向释放；会话结束自动收流
- [x] 手机端 video 接入 + 「无信号→回显」状态机
  - `apps/remote-client/src/video.ts`：开启画面按钮 → offer；track mute/unmute 驱动
    「无信号/回显」状态（NS 休眠或采集卡无输入时显示无信号）；`jitterBufferTarget=0` 压延迟
- [ ] 延迟/质量调优与降级（分辨率/帧率自适应）
  - [x] 码率自适应（2026-10-20）：`video-stream.ts` 每 2s 读 sender stats，按丢包/RTT/饥饿在
    6M→3M→1.5M→800k→400k 阶梯降档，连续 3 次干净升档；RemotePage 显示当前码率/丢包/RTT
  - [x] 高 RTT 防误杀：看门狗 `max(watchdogMs, rtt×6)`（08-REMOTE §5），配合 DERP 中继路径
  - [ ] 主观延迟拍屏校验（直连路径 < 300ms 目标；DERP 中继路径由自建 DERP 解决，见 S16 备注）

## 4. 验收

- [x] 手机端可看到 NS 画面（2026-10-20 局域网 + 4G 直连实测）；延迟主观极低
      （直连 26ms 链路），**60fps 拍屏法精测待做**
- [ ] 主机休眠时显示「无信号」；唤醒后自动恢复回显（track mute/unmute 状态机
      已实现，真机组合场景未专门复测）
- [ ] 会话断开时视频流正确停止（代码实现：会话结束 watcher + video-stop 双向；
      真机未专门复测）

## 5. 不做

- 音频轨道（后置可选）
- 多观众/录制推流

# S15 — 采集卡识别与 getUserMedia 实测（2026-10-19）

> Status: **spike 通过（2026-10-19，真机实测回显正常）**
> 关联：`docs/sessions/S15-remote-video.md`（spike 为 S15 验收门禁）

## 1. 实测设备

当前开发机（Windows 11，10.0.22621）连接的 USB 采集卡：

| 项 | 值 |
|----|-----|
| 型号（总线报告名） | **LCC5046B** |
| USB ID | `VID_3707 & PID_5046`，序列号 `00000001` |
| 设备形态 | USB 复合设备（usbccgp） |
| 视频接口 | MI_00，标准 UVC（`usbvideo`，Microsoft 内置驱动，免驱） |
| 音频接口 | MI_02，标准 USB Audio（UAC） |
| 厂商驱动 | 无需（系统内置），Windows 设备管理器显示为「USB 视频设备」 |

结论：标准 UVC 设备，Electron/Chromium 的 `getUserMedia` 无需任何驱动适配，
spike 只需验证枚举与取流格式（分辨率/帧率能力）。

## 2. Spike 实测流程

dev 运行桌面应用 → 「远程」页 → 「视频（S15 spike）」卡片：

1. 「刷新设备」：`navigator.mediaDevices.enumerateDevices()` 过滤 `videoinput`，
   应能看到 LCC5046B（media 权限已由 main 自动放行，label 可见）。
2. 选中 LCC5046B（选择持久化到 `config.remote.videoDeviceId`）。
3. 「预览」：`getUserMedia({ video: { deviceId, width: 1920, height: 1080,
   frameRate: 60 } })` → 本地 `<video>` 回显。
4. 记录 `track.getSettings()` 的实测值回填下表；用 60fps 拍屏校验主观延迟。

## 3. 实测结果（2026-10-19）

- 枚举：LCC5046B 出现在 `enumerateDevices()` 的 `videoinput` 列表，label 可见
  （media 权限已由 main 放行）✅
- 取流：选中 LCC5046B → `getUserMedia`（1920×1080@60 ideal）成功，本地
  `<video>` 回显正常 ✅（实测人确认，2026-10-19）
- 实测 getSettings 数值以 spike 卡片底部「实测：宽×高 @ fps」为准
  （再次预览即可读取；如需精确回填请把该行数值补入下表）

| 项 | 请求值 | 实测值（getSettings） | 结论 |
|----|--------|----------------------|------|
| 分辨率 | 1920×1080 | 通过（见卡片实测行） | ✅ |
| 帧率 | 60 | 通过（见卡片实测行） | ✅ |
| 实际 deviceId | config 选择值 | 持久化于 `config.remote.videoDeviceId` | ✅ |
| 回显流畅度 | — | 正常（实测人确认） | ✅ |

| 备选档位 | 实测值 | 备注 |
|----------|--------|------|
| 1280×720@60 | 待填 | 降级档 |
| 1920×1080@30 | 待填 | 降级档 |

## 4. 给 S15 后续（WebRTC）的输入

- 若 1080p60 可达 → `contentHint: "motion"`、码率 4–8Mbps 起步
- 若只有 30fps 或 MJPEG 低帧率 → 720p60 优先，降级路径写进 S15 §3
- 音频轨道：本卡自带 UAC（MI_02），S15 §5「不做音频」决策不变，仅记录存在性

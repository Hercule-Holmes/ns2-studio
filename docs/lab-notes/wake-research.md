# 远程场景 NS 唤醒机制调研（2026-10-19）

> Status: **真机验证完成：USB 有线唤醒在该底座端口不可达（B1/B2 之外的端口层结论）；B3 防休眠保活已实现**
> 关联：远程操控功能规划（S13 远程桥 / S14 手机控制页 / S15 视频下行 / S16 公网访问）
> 实现：`packages/protocol`（`buildWakeFrame`）、`DeviceService.wake()`、
> gateway `wake` 消息接线、DevicePage/手机端按钮；固件 `CMD_WAKE 0x92`
> （EasyMCU_ESP32S3：`easycon.h`/`easycon.c`/`hid_device.c`）

## 0. 真机实测结论（2026-10-19，底座 USB-C 控制器口）

| 探针观测 | 值 |
|----------|-----|
| NS 醒着 | `mounted=1 suspended=0`，wake → `0xFF`（未休眠分支）✅ 链路通 |
| NS 休眠 | `mounted=0`，**`suspend_cb=0`（从未触发）** |

- **NS 休眠时对该端口执行「断开」而非「挂起」**：设备被主机踢下总线，
  USB 远程唤醒（resume 信号）的前提不存在 → 路线 1 排除。
- **v3 模拟重插拔**（D+ 上拉断 120ms → 合上 → 等 3s）→ 主机休眠中
  **不响应连接事件**（原因码 `0x04`）→ 路线 2 排除。
- B1（换 VID/PID）**一并排除**：掉挂载发生在身份无关的端口层面。
- 串口应答链路全程正常（Hello/Version/Debug 探针/wake 应答+原因码），
  PC 侧全链路（协议/设备层/IPC/网关/双端按钮）已就绪并回归通过。
- 若未来复测：换底座 USB-A 口、或换主机直连 USB-C 再跑一次 `wake`；
  探针命令 `ns2-smoke debug <port>` 可实时读 mounted/suspended/wakeup_en。

## 1. 背景

远程操控场景下 NS 大概率处于休眠：手机端需要「唤醒 NS」能力，否则视频无信号、
指令无人接收。本文记录调研结论、遗留缺口与实施规格。

## 2. 结论

**有线唤醒（USB Remote Wakeup）路线可行；当前唯一缺口是固件约 30 行的实现，
已声明但未实现。主机侧行为需一次真机实测确认（已有运行时判定手段）。**

## 3. 证据链

### 3.1 硬件链路天然支持

- ESP32-S3 以 USB 有线直连 NS 底座，伪装 HORI 授权手柄
  （VID `0x0F0D` / PID `0x0092`，见 `docs/easymcu/01-核心模块-HID手柄伪装.md` §3）。
- 底座 USB 口在主机休眠时保持供电——这是任天堂允许「授权有线手柄唤醒
  休眠主机」的设计基础；HORI / PowerA / PDP 有线手柄均具备唤醒能力。

### 3.2 固件现状：只声明未实现（关键缺口）

- `EasyMCU_ESP32S3/main/hid/hid_device.c:56` 配置描述符设置了
  `TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP` 属性；
- 但全源码 **无任何** `tud_remote_wakeup()` 调用、无 `tud_suspend_cb` 处理
  —— 主机休眠挂起 USB 总线后，固件只等待，永远不会发恢复信号。
- EasyCon（伊机控）生态同样没有主机唤醒功能：其脚本中的「唤醒设备」
  只是游戏内连按摇杆键的操作。

### 3.3 协议栈与芯片全支持

- TinyUSB 设备 API：`tud_remote_wakeup()`（*"only if suspended and enabled
  by host"*）、`tud_suspend_cb(bool remote_wakeup_en)`、`tud_resume_cb()`。
- ESP32-S3 的 DWC2 底层驱动已实现 `dcd_remote_wakeup()`
  （`DCTL_RWUSIG` 恢复信号 + 20ms resume delay）。

### 3.4 USB 规范下的完整唤醒流程

```text
主机休眠前: SET_FEATURE(DEVICE_REMOTE_WAKEUP) 启用该设备远程唤醒
主机休眠:   挂起 USB 总线
PC 发命令:  串口 [Ready, Wake(0x92)] → 固件收到
固件执行:   tud_remote_wakeup() 发恢复信号 → 总线恢复
            → HOME 按下 ~200ms → 松开 → NS 亮屏回 HOME 桌面
```

`tud_suspend_cb` 的 `remote_wakeup_en` 参数可在运行时**确定性地**判定
Switch 是否对本手柄身份启用了远程唤醒——真机验证一次即有答案。

### 3.5 时序预期

唤醒信号 ~50ms + NS 休眠恢复到桌面约 1–3s → UI 需要「唤醒中…」状态。

## 4. 决策记录

| 决策 | 内容 | 日期 |
|------|------|------|
| D1 | 固件侧修改**暂缓**（固件仓库不在本期工作范围），PC 侧先按本文规格预留 | 2026-10-19 |
| D2 | 唤醒触发方式：**手机端手动点「唤醒 NS」按钮 → 等待视频画面回显确认**；不做会话建立时自动唤醒 | 2026-10-19 |
| D3 | 命令号预留 `CMD_WAKE = 0x92`（0x91 之后第一个空闲值），固件落地前 PC 侧仅发送并报告「固件未实现」 | 2026-10-19 |
| D4 | **开工实现**（硬件齐全，用户自行烧录）：PC 三层 + 固件同日落地，协议契约见 `02-PROTOCOL.md` §3.4 | 2026-10-19 |

## 5. 实施规格（待固件侧具备条件后执行）

### 5.1 固件（EasyMCU_ESP32S3，约 30 行）

1. `easycon.h`：新增 `#define CMD_WAKE 0x92`；
2. 实现 `tud_suspend_cb(bool remote_wakeup_en)`：记录挂起状态与
   `remote_wakeup_en` 标志；
3. Wake 命令处理：
   - 非挂起 → 直接回 `Ack(0xFF)`（主机已唤醒）；
   - 挂起且 `remote_wakeup_en` → `tud_remote_wakeup()` → 等 `tud_resume_cb`
     （超时 ~500ms）→ HOME 按下 200ms → 松开 → 回 `Ack`；
   - 挂起但未启用 → 回 `Error(0x00)`（明确报告「主机未启用有线唤醒」）。

### 5.2 PC 侧（ns2-studio）

- `packages/protocol`：`Wake` 命令编码 + 单测；
- `main/device/`：`DeviceService.wake()`（发送 + 等 Ack + 超时/重试）；
- 远程桥（S13）：WS 消息 `wake`；
- 手机端（S14）：「唤醒 NS」大按钮；视频无信号时重点引导；
  点击后进入「唤醒中…」状态，以**画面回显恢复**作为成功判据；
- 桌面端（S15）：Device 页「唤醒主机」按钮。

## 6. 验证清单（并入 S0 硬件冒烟）

1. NS 休眠后确认 ESP32 保持枚举（LED / 日志）；
2. **记录 `tud_suspend_cb` 的 `remote_wakeup_en` 真值**（路线成立与否的判定点）；
3. 触发唤醒 ×10 次成功率；TV 关闭（CEC off）场景复测；
4. 唤醒后确认报告链路恢复（hub 状态、按键响应）。

## 7. 兜底策略（若 Switch 不对该手柄身份启用远程唤醒）

- **B1**：固件换用已知支持唤醒的授权手柄 VID/PID（小改）；
  → 2026-10-19 排除：失败在端口层（休眠即断开），与身份无关
- **B2**：追加一块 **ESP32 classic** 蓝牙手柄（BT 配对后按 HOME 唤醒最可靠；
  注意 ESP32-S3 无经典蓝牙，需 classic 型号）；
  → **彻底方案，待排期**（约 ¥20 硬件）
- **B3**：「防休眠」辅助——NS 底座模式默认不自动休眠，可提供可选
  「保活」周期输入，降低进入休眠概率。
  → **已实现（2026-10-19）**：`main/remote/keepalive.ts`，远程会话激活期间
  每 `remote.keepaliveMs`（默认 20s，可关）注入 LX 微动并还原；仅在
  `remote` 源活跃且无真实输入时触发，RemotePage 可配置。远程使用姿势：
  出门前手动唤醒 NS → 手机接管 → 保活维持在线。

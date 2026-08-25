# 01 — 系统架构

## 1. 逻辑架构

```text
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer (UI Process)                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Device   │ │ Virtual  │ │ Timeline │ │ Amiibo   │ │ Record │ │
│  │ Panel    │ │ Pad      │ │ Editor   │ │ Library  │ │ / Log  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       └────────────┴────────────┴────────────┴───────────┘      │
│                              │ preload IPC (typed)               │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                        Main Process                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐             │
│  │ DeviceSvc   │  │ InputHub    │  │ TimelineEng  │             │
│  │ (serial)    │  │ (仲裁输出源) │  │ (时钟+编译)   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘             │
│         │                │                │                      │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼───────┐             │
│  │ Protocol    │  │ ProCapture  │  │ ProjectStore │             │
│  │ encode/dec  │  │ (node-hid)  │  │              │             │
│  └──────┬──────┘  └─────────────┘  └──────────────┘             │
└─────────┼────────────────────────────────────────────────────────┘
          │ USB-UART
┌─────────▼─────────┐
│ ESP32-S3 Firmware │  USB-HID gadget + (optional) Amiibo
└─────────┬─────────┘
          │ USB
     Nintendo Switch 2
```

## 2. 模块职责

| 模块 | 进程 | 职责 | 非职责 |
|------|------|------|--------|
| `packages/pad-types` | 共享 | 按键枚举、PadReport、结果类型 | UI、I/O |
| `packages/protocol` | 共享/Main | 7bit 打包、命令帧、ACK 解析 | 业务策略 |
| `packages/timeline-model` | 共享 | 工程 schema、校验、编译为帧流 | 渲染 |
| `apps/desktop` main DeviceSvc | Main | 串口生命周期、心跳、下发、Amiibo 分包 | 时间轴 UI |
| `apps/desktop` main InputHub | Main | 选择唯一输出源，统一 `applyReport` | 协议细节 |
| `apps/desktop` main ProCapture | Main | 读 Pro/通用手柄 → PadReport | 串口 |
| `apps/desktop` main TimelineEng | Main | 高分辨率时钟回放 | 编辑手感 |
| `apps/desktop` renderer * | Renderer | 可视化编辑与展示 | 直接碰 serialport |

## 3. 关键运行时数据流

### 3.1 虚拟手柄实时控制

```text
Renderer VPad pointer/keyboard
  → IPC pad:setReport(PadReport)
  → InputHub (source=manual)
  → Protocol.encodeReport
  → Serial write
  → MCU HID → NS2
```

### 3.2 时间轴回放

```text
Project JSON
  → timeline-model.compile(project, fps)
  → frame[] or generator
  → TimelineEng tick (hrtime)
  → InputHub (source=timeline)
  → Protocol → Serial → MCU
```

### 3.3 Pro 转发 + 可选录制

```text
node-hid poll（NS2 Pro 有线）
  → mapToPadReport
  → InputHub (source=forward)
  → Serial
  └→ Recorder.append(frame)  // 旁路
```

### 3.4 Amiibo

```text
Import .bin → Library (disk)
  → IPC amiibo:save(slot, bytes)
  → DeviceSvc.SaveAmiibo (20B chunks + ACK)
  → MCU

Timeline Amiibo clip at T
  → ChangeAmiiboIndex(slot)
```

## 4. 输出源仲裁（InputHub）

同一时刻仅一个 **active source**：

| source | 触发 |
|--------|------|
| `idle` | 默认；可保持 last report 或中立 |
| `manual` | 虚拟垫/键位捕获开启 |
| `forward` | Pro 转发开启 |
| `timeline` | 时间轴播放中 |

切换 source 时必须：`resetToNeutral()` 再切换，防止卡键。

## 5. 进程与线程约束

- **串口写**：Main 单写队列，最小间隔（建议 1–4ms 可配），合并 pending report（只发最新）。
- **回放时钟**：Main `process.hrtime.bigint()`，不靠 rAF。
- **UI 预览**：Renderer rAF 只负责画播放头；以 Main 广播的 `playback:time` 为准。
- **禁止** Renderer 直接 `require('serialport')`。

## 6. IPC 契约（概要）

详细类型放 `apps/desktop/src/shared/ipc.ts`（S2 创建）。命名空间：

| Channel 前缀 | 方向 | 用途 |
|--------------|------|------|
| `device:*` | 双向 | 连接、版本、reset |
| `pad:*` | R→M | setReport / reset |
| `hub:*` | 双向 | setSource / 状态 |
| `timeline:*` | 双向 | load/play/pause/stop/seek |
| `capture:*` | 双向 | list devices / start forward / record |
| `amiibo:*` | 双向 | list/import/save/select |
| `log:*` | M→R | 日志流 |
| `playback:time` | M→R | 播放头时间 |

## 7. 错误与安全复位

| 事件 | 行为 |
|------|------|
| 串口断开 | source→idle，UI 提示，report 丢弃 |
| 播放停止/暂停 | 发送中立 report |
| 应用退出 | 中立 report + close port |
| ACK 超时 | 重试策略（命令类）；report 流不逐帧 ACK |

## 8. 与 EasyCon 架构差异（有意为之）

| EasyCon | NS2 Studio |
|---------|------------|
| .NET + Avalonia/WinForms | Electron |
| 自研 ECS 脚本为核心 | 时间轴工程为核心 |
| 图像识别一等公民 | 不做（v1） |
| 事件文本录制为主 | 帧流 + 可烘焙时间轴 |
| 全功能自动化平台 | 控制台 + 宏工作室工具 |

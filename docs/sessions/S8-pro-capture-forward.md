# S8 — NS2 Pro / 通用手柄采集与转发

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S3） |
| **Priority** | P1 |
| **Depends on** | S3 |
| **Blocks** | M4 |
| **Owns** | `apps/desktop/src/main/capture/**`, 手柄选择 UI |
| **Estimate** | 2–3 天 |

## 1. 目标

读取 PC 上的手柄输入，映射为 `PadReport`，经 Hub `forward` 源实时下发；为 S7 提供高质量输入源。

## 2. 上下文注入

- EasyCon `GamepadMapper.cs` / `GamepadInputBinder.cs`
- RISKS R3
- Windows：优先方案顺序见下

## 3. 输入后端优先级

| 优先级 | 后端 | 适用 |
|--------|------|------|
| 1 | Windows.Gaming.Input / XInput 封装 | Xbox、许多通用垫 |
| 2 | `node-hid` 原始 HID | NS2 Pro 专用报告 |
| 3 | SDL2 原生 addon | 后置兜底 |

**MVP 要求：** 至少一种后端在开发机可用（可为 Xbox 垫）。  
**Stretch：** NS2 Pro 有线 HID 解析。

## 4. 任务清单

- [ ] 枚举设备列表 IPC
- [ ] 轮询/事件 125–250Hz
- [ ] map：ABXY、肩键、扳机阈值、DPad→HAT、摇杆轴+Y 翻转、可选 swap ABXY
- [ ] `setSource(forward)` 启动；停止时 neutral
- [ ] 校准/死区配置项
- [ ] 掉线处理
- [ ] lab-note：NS2 Pro 的 VID/PID、report 长度、样例 hex（若有）

### NS2 Pro 专项子任务

- [ ] USB 插入后 hid 枚举过滤
- [ ] 对照社区/自抓包定义 parser
- [ ] 解析失败时回退「不支持」而不是乱发

## 5. 验收

- [ ] 通用手柄转发可在 NS2 菜单移动光标
- [ ] 延迟主观可接受
- [ ] 与 S7 联调：转发时可录制

## 6. 不做

- 体感陀螺完整（可预留字段）
- 蓝牙配对工具大而全（EasyCon BT 窗体级）

## 7. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

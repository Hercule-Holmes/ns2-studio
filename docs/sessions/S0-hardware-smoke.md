# S0 — 硬件通路冒烟（PC → ESP32-S3 → NS2）

| 字段 | 值 |
|------|-----|
| **Status** | `ready` |
| **Priority** | P0 |
| **Depends on** | 无 |
| **Blocks** | 真机相关的 S3/S6/S8/S9 验收；不阻塞 S1/S4 单测 |
| **Owns** | `tools/serial-smoke/**`, `docs/lab-notes/**`, `firmware/README.md` |
| **Estimate** | 0.5–2 天 |

## 1. 目标

证明：**PC 串口发送的手柄状态能被 ESP32-S3 变成 HID，并被 NS2 接受。**

## 2. 上下文注入（新 Session 必读）

- 愿景：`docs/architecture/00-VISION.md`
- 协议：`docs/architecture/02-PROTOCOL.md`
- EasyCon 参考：
  - `EasyCon/fw/ESP32_EasyCon_V1.9.2.bin`
  - `EasyCon/src/EasyCon.Device/Utils/SwitchReport.cs`
  - `EasyCon/docs/GETTING_STARTED.md`
- 硬件：ESP32-S3-DevKitC-1、NS2、PC、足够 USB 线

## 3. 任务清单

### 3.1 固件与接线

- [ ] 查找并记录 EasyMCU / EasyCon 对 **ESP32-S3-DevKitC-1** 的官方刷写步骤（端口、boot 键、分区）
- [ ] 刷入候选固件（优先仓库自带 bin，或上游 release）
- [ ] 画清线：
  - 哪口接 **NS2（USB device/HID）**
  - 哪口/UART 接 **PC（串口控制）**
- [ ] 在 `firmware/README.md` 写下当前采用的固件文件名、版本、来源 URL、刷写命令
- [ ] 在 `docs/lab-notes/S0-wiring.md` 记录接线（可用文字示意图）

### 3.2 主机侧确认

- [ ] NS2：控制器页面进入更改握法/顺序或系统设置 → 控制器
- [ ] 确认出现新控制器（截图或文字描述写入 lab-note）
- [ ] 若 **完全不出现**：标记 R1，转入 **S0b**，本 Session 以「失败复现文档」收尾

### 3.3 PC 串口冒烟工具

实现 `tools/serial-smoke`（可用 Node + serialport，或 Python；推荐 Node 以便与 monorepo 一致）：

- [ ] 列出串口
- [ ] 打开端口 115200（失败试 9600）
- [ ] 发送 Hello 握手，打印 RX hex
- [ ] 发送中立 report
- [ ] 发送 A 按下 report → sleep 100ms → A 释放/中立
- [ ] 发送左摇杆上 → 中立
- [ ] CLI 用法写入工具 README

**实现策略：**

- Phase A：可先 **硬编码 hex**（用 EasyCon 跑出来的对拍值）完成冒烟
- Phase B：若 S1 已完成，改为依赖 `@ns2-studio/protocol`

### 3.4 稳定性快测

- [ ] 连续 50 次 A，观察是否丢键/卡键
- [ ] 拔掉 PC 串口，确认 NS2 侧是否卡键；记录固件行为
- [ ] 记录可稳定工作的 `minIntervalMs`

## 4. 交付物

| 产物 | 路径 |
|------|------|
| 冒烟工具 | `tools/serial-smoke/` |
| 固件说明 | `firmware/README.md` |
| 实验笔记 | `docs/lab-notes/S0-*.md` |
| MATRIX/RISKS 更新 | 若失败更新 R1 |

## 5. 验收标准

**通过：**

1. NS2 识别为手柄  
2. smoke 命令触发的 A 在系统 UI 可见  
3. 摇杆方向正确（注意 Y 轴是否需翻转，记入笔记）  
4. lab-note 含：固件 hash/文件名、COM 口、波特率、OS 版本  

**失败但合格收尾：**

1. 复现步骤完整  
2. 已开 S0b 并填写假设（描述符/供电/仅 NS1 固件等）

## 6. 明确不做

- Electron UI  
- 时间轴  
- Amiibo  
- Pro 读取  

## 7. 交接给下游

- 给 **S2**：默认波特率、端口命名现象、Hello 是否必需  
- 给 **S1**：若手写了对拍 hex，贴进 lab-note 供测试向量  
- 给 **S0b**：失败日志与 USB 枚举信息（Windows 设备管理器）

## 8. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

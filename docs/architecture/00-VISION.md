# 00 — 产品愿景与范围

## 1. 一句话

**NS2 Studio**：在 PC 上用图形界面编排/录制/转发手柄输入，经 ESP32-S3 伪装控制器驱动 Nintendo Switch 2，并支持 Amiibo 数据下发与时间轴触发。

## 2. 用户场景

| 场景 | 描述 |
|------|------|
| 键鼠/虚拟垫游玩 | 无实体 Pro 时用 PC 操作 NS2 |
| Pro 实时转发 | NS2 Pro → PC → MCU → NS2（桥接/录制旁路） |
| 宏排轴 | 时间轴可视化编辑连招/重复操作并回放 |
| Amiibo 工作流 | 管理 bin、写入设备槽位、在宏中切换 |

## 3. In Scope（MVP → v1）

- Electron 桌面应用（Windows 优先）
- EasyCon 兼容串口协议（联机模式全量 report + 基础命令 + Amiibo 命令）
- 虚拟手柄 UI
- 时间轴排轴器（按键/摇杆/HAT/Amiibo 轨道）
- NS2 Pro（或通用手柄）采集、转发、帧录制
- Amiibo 库与 Save/ChangeIndex
- 工程文件保存/加载

## 4. Out of Scope（明确不做或后置）

| 项 | 说明 |
|----|------|
| 自研脚本语言 / ECS 兼容执行器 | v1 用时间轴编译为 report 流即可 |
| 采集卡 + OpenCV 识图自动化 | EasyCon 强项；本项目非目标 |
| 烧录模式（脚本在 MCU 独立跑） | 可后置；先联机 |
| 非 Windows 一等公民 | Linux/macOS 结构预留，不保证 HID/串口 |
| 在线对战/反作弊对抗 | 仅本地单机工具定位 |
| 纯软件虚拟手柄直接控 NS2 | 主机侧必须有 HID 执行器（MCU） |

## 5. 成功标准（产品级）

1. PC 经 S3 可在 NS2 系统菜单稳定完成按键与摇杆操作。
2. 时间轴工程可编辑、保存、打开、回放，回放与编辑预览一致。
3. Pro（或 XInput 手柄）可实时转发，延迟可感知但可玩（目标 < 30ms 软件路径，不含无线）。
4. Amiibo bin 可写入槽位并在时间轴指定时刻切换（固件支持前提下）。
5. 断线/停止时无卡键（摇杆回中、按键全释放）。

## 6. 技术选型（已定）

| 层 | 选型 | 备注 |
|----|------|------|
| 桌面壳 | Electron + Vite | 用户指定 |
| UI 框架 | Vue 3 + TypeScript（默认） | Session S2 可微调，需记入文档 |
| 主进程 I/O | serialport / node-hid；瓶颈时改 napi | |
| 协议 | TypeScript 包，对齐 EasyCon | 见 02-PROTOCOL |
| 固件 | EasyMCU / EasyCon ESP32 固件，必要时 fork | S0 验证 |
| 硬件 | ESP32-S3-DevKitC-1 + NS2 + NS2 Pro + PC | 已具备 |

## 7. 参考代码锚点（EasyCon）

| 概念 | 路径 |
|------|------|
| Report 模型 | `EasyCon/src/EasyCon.Device/Utils/SwitchReport.cs` |
| 按键/HAT/摇杆常量 | `EasyCon/src/EasyCon.Device/Utils/SwitchCommand.cs` |
| 命令字 | `EasyCon/src/EasyCon.Device/Utils/CommandCode.cs` |
| 连接与 Amiibo | `EasyCon/src/EasyCon.Device/NintendoSwitchCmd.cs` |
| 按键状态机 | `EasyCon/src/EasyCon.Device/JoyStickDevice.cs` |
| PC 手柄映射 | `EasyCon/src/EasyCon.WinInput/GamepadMapper.cs` |
| 事件录制 | `EasyCon/src/EasyCon.Device/OperationRecords.cs` |
| ESP32 固件 bin | `EasyCon/fw/ESP32_EasyCon_V1.9.2.bin` |

# Firmware

本目录放置或链接 **ESP32-S3** 侧固件。

## 当前策略

1. 优先使用 EasyCon 附带 / EasyMCU 发布的 ESP32 构建（见 `../EasyCon/fw/` 或上游 Release）。
2. 在 **S0** 验证 NS2 识别情况。
3. 若失败，激活 **S0b**，fork 固件源到此目录或 git submodule。

## S0 候选固件记录

> 状态：已确认文件存在并取 hash；**待 S0 实机刷写验证**（见 `docs/lab-notes/S0-pending-hardware.md`）。

### 首选：EasyMCU_ESP32S3（EasyConNS 官方 ESP32-S3 下位机）

来源仓库：`F:\nstool\EasyMCU_ESP32S3`（ESP-IDF 工程；README.md 见仓库根目录）

| 项 | 值 |
|----|-----|
| 文件名 | `EasyMCU_ESP32S3_n16r8.bin` |
| 路径 | `F:\nstool\EasyMCU_ESP32S3\release_bins\EasyMCU_ESP32S3_n16r8.bin` |
| 版本 | 仓库现装版本（未标注版本号，以 bin 为准） |
| SHA256 | `28043166A0CF221978C2D9D0F844720B0A73BF07A1685C64BCDFABECA9E6AC2E` |
| 大小 | 342320 字节 |
| 适用板子 | ESP32-S3-DevKitC-1 **N16R8**（已测试型号） |
| 刷写工具 | ESP Flash Download Tool（Espressif），芯片选 ESP32-S3 |
| 刷写地址 | `0x0` |
| 进入烧录模式 | 按住 BOOT → 点按 RST → 松开 BOOT |
| NS2 识别 | 待验证 |
| Amiibo | 未知 |
| 串口协议 | EasyCon 兼容（预期） |

接线（与仓库 README 一致）：

- 背面标 **`com`** 的 USB-C 口 → 电脑（串口命令/烧录）
- 背面标 **`usb`** 的 USB-C 口 → Nintendo Switch（HID）

### 备选：ESP32_EasyCon_V1.9.2（经典 ESP32，非 S3）

| 项 | 值 |
|----|-----|
| 文件名 | `ESP32_EasyCon_V1.9.2.bin` |
| 路径 | `F:\nstool\EasyCon\fw\ESP32_EasyCon_V1.9.2.bin` |
| 版本 | 1.9.2 |
| SHA256 | `9D8D211E5297C492B2B11CE3E8F3B74F0BDC196537AC2EA0D2427B01A154354E` |
| 大小 | 1013312 字节 |
| 适用板子 | 经典 ESP32（**非** ESP32-S3；仅作对照） |
| 备注 | 仅当 S3 固件不可用时参考其行为/协议 |

## 接线（S0 填写）

- PC 控制口：ESP32-S3-DevKitC-1 背面标 `com` 的 USB-C 口
- NS2 HID 口：ESP32-S3-DevKitC-1 背面标 `usb` 的 USB-C 口
- 供电注意：烧录与串口调试由 PC 口供电；接 NS2 时确认 NS2 供电/识别正常（记录于 lab-note）
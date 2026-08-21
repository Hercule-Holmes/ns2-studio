# Firmware

本目录放置或链接 **ESP32-S3** 侧固件。

## 当前策略

1. 优先使用 EasyCon 附带 / EasyMCU 发布的 ESP32 构建（见 `../EasyCon/fw/` 或上游 Release）。
2. 在 **S0** 验证 NS2 识别情况。
3. 若失败，激活 **S0b**，fork 固件源到此目录或 git submodule。

## 记录模板（S0 填写）

| 项 | 值 |
|----|-----|
| 来源 | |
| 文件名 | |
| 版本 | |
| SHA256 | |
| 刷写工具/命令 | |
| 适用板子 | ESP32-S3-DevKitC-1 |
| NS2 识别 | 是/否 |
| Amiibo | 是/否/未知 |
| 串口协议 | EasyCon 兼容 是/否 |

## 接线（S0 填写）

- PC 控制口：
- NS2 HID 口：
- 供电注意：

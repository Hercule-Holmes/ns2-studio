# @ns2-studio/serial-smoke

S0 硬件通路冒烟 CLI：PC ↔ ESP32-S3（EasyCon/EasyMCU 固件）串口冒烟工具。

- 依赖 `serialport`（Node ≥ 20，pnpm workspace 成员 `tools/*`）。
- **Phase A**：7bit 报文字节直接硬编码（与 EasyCon C# `SwitchReport.GetBytes` 对拍值，见 `src/packets.mjs`），不依赖 `packages/protocol`。
- 无硬件时所有命令优雅报错，`list` 可正常运行。

## 安装

```bash
cd tools/serial-smoke
pnpm add serialport
```

> 若 pnpm 提示忽略 `@serialport/bindings-cpp` 的 build script：该包使用预编译二进制，通常无需构建即可加载；如加载失败，运行 `pnpm approve-builds` 放行后再试。

## 用法

```bash
node src/index.mjs <command> [args]     # 或安装后: ns2-smoke <command> [args]
```

| 子命令 | 说明 |
|--------|------|
| `list` | 列出可用串口（`COMx` / `/dev/ttyUSBx`） |
| `hello <port>` | 打开 115200（失败回退 9600，8N1），发 `[A5 81]` 最多 3 次，等待 `0x80` (Reply.Hello)，打印 RX hex |
| `neutral <port>` | 发送中立 report `00 00 01 08 04 02 01 80` |
| `press-a <port>` | A 按下 → 100ms → 释放回中立 |
| `stick-up <port>` | 左摇杆上 (LY=0) → 500ms → 回中立 |
| `report <port> <hex...>` | 发送任意 7bit 报文字节（如 `report COM3 00 00 01 08 04 02 01 80`） |

`<port>` 示例：`COM3`（Windows）、`/dev/ttyUSB0`（Linux/macOS）。

## 已验证报文字节（与 `EasyCon/src/EasyCon.Device/Utils/SwitchReport.cs` 对拍）

| 动作 | 原始字段 (Button hi,lo / HAT / LX / LY / RX / RY) | 7bit 报文 |
|------|--------------------------------------------------|-----------|
| 中立 | `00 00 08 80 80 80 80` | `00 00 01 08 04 02 01 80` |
| A 按下 (0x0004) | `00 04 08 80 80 80 80` | `00 01 01 08 04 02 01 80` |
| 左摇杆上 (LY=0) | `00 00 08 80 00 80 80` | `00 00 01 08 00 02 01 80` |

`src/packets.mjs` 中的 `pack7Bit(serialized)` 可复现上述报文，供 Phase B 切换到 `@ns2-studio/protocol` 时对拍。

## 波特率与回退

默认 115200 打开失败后自动回退 9600（与 EasyCon 行为一致），两次均失败时输出清晰错误并退出码 1。
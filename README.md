# NS2 Studio

PC 端 Electron 应用：经 ESP32-S3 控制 Nintendo Switch 2，支持虚拟手柄、NS2 Pro 录制/转发、时间轴宏排轴、Amiibo。

> 当前仓库以 **架构与多 Session 工单文档** 为主；代码按 Session 逐步落地。  
> 协议对齐开源项目 [EasyCon](../EasyCon)（伊机控），但 **独立新建**，不嵌入其 .NET UI。

## 文档入口

**从这里开始：** [docs/README.md](./docs/README.md)

| 最重要 | 链接 |
|--------|------|
| Session 总表与并行 | [docs/architecture/04-SESSION-MATRIX.md](./docs/architecture/04-SESSION-MATRIX.md) |
| 系统架构 | [docs/architecture/01-SYSTEM-ARCHITECTURE.md](./docs/architecture/01-SYSTEM-ARCHITECTURE.md) |
| 协议 | [docs/architecture/02-PROTOCOL.md](./docs/architecture/02-PROTOCOL.md) |
| 工单目录 | [docs/sessions/](./docs/sessions/) |

## 第一波建议开工

1. **S0** 硬件冒烟 — `docs/sessions/S0-hardware-smoke.md`
2. **S1** 协议包 — `docs/sessions/S1-protocol-package.md`（可与 S0 并行）

## 硬件（已规划）

- PC (Windows)
- Nintendo Switch 2
- NS2 Pro
- ESP32-S3-DevKitC-1

## 状态

- 文档基线日期：2026-08-21
- 代码：尚未初始化 monorepo（待 S1/S2）

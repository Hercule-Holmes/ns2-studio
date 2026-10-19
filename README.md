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
| 远程操控 | [docs/architecture/08-REMOTE.md](./docs/architecture/08-REMOTE.md) |
| 工单目录 | [docs/sessions/](./docs/sessions/) |

## 第一波建议开工

1. **S0** 硬件冒烟 — `docs/sessions/S0-hardware-smoke.md`
2. **S1** 协议包 — `docs/sessions/S1-protocol-package.md`（可与 S0 并行）
3. **S2** Electron 壳 + 设备连接 — `docs/sessions/S2-electron-shell.md`（已完成）

## 运行桌面应用

前置：Node ≥ 20、pnpm。仓库为 pnpm workspace monorepo。

```bash
pnpm install

# 开发模式（HMR）
pnpm --filter @ns2-studio/desktop dev

# 构建 / 类型检查 / 单测
pnpm --filter @ns2-studio/desktop build
pnpm --filter @ns2-studio/desktop typecheck
pnpm --filter @ns2-studio/desktop test
```

无硬件演示（Mock 串口）：`NS2_STUDIO_MOCK_SERIAL=1` 时 DeviceService 用内存 mock
模拟 Hello/Version/Ack/报告接收，可完整走连接流程：

```bash
$env:NS2_STUDIO_MOCK_SERIAL = "1"   # PowerShell
pnpm --filter @ns2-studio/desktop dev
```

### 手机远程操控（S13/S14，已实现代码 + 单测）

1. 桌面端「远程」页 → 启动服务（默认端口 8787，首次自动生成访问令牌）
2. 手机浏览器扫页面上的二维码（`http://<PC IP>:8787/?t=<token>`）
3. 连接 → 接管控制 → 触屏手柄实时操控；锁屏/断开会自动中立化并释放

手机端页面源码在 `apps/remote-client`（vanilla TS + Vite），构建产物输出到
`apps/desktop/out/remote-client` 由远程桥托管；`desktop dev/build` 会自动先
构建它。无手机时可用电脑浏览器打开同一链接模拟。

外出（4G）访问需 PC 与手机都安装并登录 [Tailscale](https://tailscale.com)，
扫码页会列出可直连的地址（详见 `docs/sessions/S16-remote-public.md`）。

原生模块（serialport）说明：serialport@12 的 `@serialport/bindings-cpp` 使用
**N-API prebuild**，Electron 下无需 electron-rebuild / C++ 工具链即可加载；
详见 `apps/desktop/README.md`。

## 硬件（已规划）

- PC (Windows)
- Nintendo Switch 2
- NS2 Pro
- ESP32-S3-DevKitC-1

接线与刷写：见 `docs/sessions/S0-hardware-smoke.md` 与 `docs/lab-notes/S0-wiring.md`。

## 状态

- 文档基线日期：2026-08-21
- 代码：monorepo 已初始化；S1（protocol/pad-types）、S4（timeline-model）done，S2（desktop 壳 + 设备连接）done（mock 串口可演示，真机待 S0）
- 远程操控：S13 远程桥 + S14 手机控制页代码与单测完成（mock 可全链路演示，真机/真手机联调待验）；S15 视频下行、S16 公网访问待开工
- NS 唤醒调研完成（`docs/lab-notes/wake-research.md`）：固件 CMD_WAKE 0x92 待 EasyMCU 侧实现，PC 侧已预留

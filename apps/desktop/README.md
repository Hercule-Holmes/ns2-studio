# @ns2-studio/desktop

Electron 壳 + 设备连接（S2）。`electron-vite` + Vue 3 + TypeScript。

## 快速开始

```bash
# 依赖安装（根目录）
pnpm install

# 开发模式（HMR）
pnpm --filter @ns2-studio/desktop dev

# 生产构建
pnpm --filter @ns2-studio/desktop build

# 类型检查
pnpm --filter @ns2-studio/desktop typecheck

# 单测（DeviceService / 写队列，纯 mock 串口层）
pnpm --filter @ns2-studio/desktop test
```

## 无硬件演示：Mock 串口

设置环境变量后，DeviceService 使用内存 mock（模拟 Hello/Version/Ack/报告接收），
无需硬件即可演示完整连接流程：

```bash
$env:NS2_STUDIO_MOCK_SERIAL = "1"
pnpm --filter @ns2-studio/desktop dev
```

Mock 行为（`src/main/device/mock-serial-layer.ts`）：

- `listPorts()` 返回 `["MOCK-COM1"]`
- open 成功后，写入 Hello `[0xA5, 0x81]` → 回复 `0x80`（`Reply.Hello`）
- 写入 Version `[0xA5, 0x85]` → 回复 ASCII `mock`
- 连接后 ~150ms 推入一帧中立 PadReport，演示 RX 报告解码
- Amiibo 命令应答（S9 追加）：`[A5, idx, 0x91]`（ChangeAmiiboIndex）→ `0xFF`；
  `[A5, offLo, offHi, lenLo, lenHi, idx, 0x90]`（SaveAmiibo 头）→ `0xFF` 并等待
  body；随后的 ≤20B body → `0xFF`。配合 `AmiiboPage` 可在无硬件时走通保存/切换
  流程（详见 `INTEGRATION.md`）。

真实串口（未设置该变量）走 `serialport@^12`，见下方原生模块说明。

## 原生模块：serialport 与 Electron ABI

`@serialport/bindings-cpp@12` 通过 `prebuildify --napi` 发布 **N-API（napi）** 预编译产物。
N-API 与 Node/Electron 的 ABI 解耦，Electron 下可直接加载，**无需** electron-rebuild
或本机 C++ 工具链。

验证：`electron-vite build` + 启动 Electron 时串口层正常 `require("serialport")`，
无 `NODE_MODULE_VERSION` 报错。

若将来 Electron 主版本升级导致加载失败：

1. 检查 `node_modules/.pnpm/@serialport+bindings-cpp@*/node_modules/@serialport/bindings-cpp/prebuilds/`
   是否包含当前平台 `napi` 构建；
2. 否则回到 Mock 路径演示（`NS2_STUDIO_MOCK_SERIAL=1`），并在
   `docs/architecture/07-RISKS.md` 更新 R10；
3. 备选：安装 electron-rebuild 并执行 `pnpm --filter @ns2-studio/desktop exec electron-rebuild`
   （需要本机 C++ 工具链 + VS Build Tools）。

`serialport` 在主进程被外部化（`externalizeDepsPlugin`），产物通过 `require("serialport")`
加载；`@ns2-studio/*` workspace 包（TS 源码）被显式排除外化、随主进程打包。

### node-hid（S8 采集）

`node-hid@^3` 也是 native 模块，经 `pkg-prebuilds-verify` 走平台 prebuild（Windows 提供
win32-x64 N-API 产物），安装时无需本机 C++ 工具链；`pnpm-workspace.yaml` 的 `allowBuilds`
已放行其 build script。采集路径在主进程**懒加载**（`src/main/capture/node-hid-layer.ts`），
加载失败会缓存错误并降级为「采集不可用」，不影响应用其它功能。若 Electron 主版本升级导致
加载失败：按上方 serialport 的 1–3 步处理（检查 prebuilds → 用 Mock 演示 → electron-rebuild）。

## 进程安全模型

- `contextIsolation: true`，`nodeIntegration: false`
- preload 仅暴露类型化的 `window.api`（`src/preload/index.ts`）
- Renderer 禁止直接 `require("serialport")`（架构文档 §5）

## 目录结构

```text
src/
├── main/
│   ├── index.ts               # 主进程入口（窗口 + 生命周期）
│   ├── device/
│   │   ├── device-service.ts  # 连接状态机 + 握手 + RX 解码
│   │   ├── report-writer.ts   # 单写队列（minInterval + 只发最新）
│   │   ├── serial-factory.ts  # mock 开关（NS2_STUDIO_MOCK_SERIAL）
│   │   ├── serial-port-layer.ts
│   │   ├── mock-serial-layer.ts
│   │   └── types.ts
│   ├── ipc/register.ts        # IPC handler 绑定
│   └── config/store.ts        # 手写 JSON 持久化（上次端口/波特率）
├── preload/index.ts           # window.api 暴露
├── renderer/                  # Vue 3 UI
│   ├── App.vue                # 侧栏 + RouterView
│   ├── router.ts              # NAV_ITEMS 配置数组驱动导航
│   └── pages/DevicePage.vue   # 设备页（端口/波特率/状态灯/日志）
└── shared/
    ├── channels.ts            # IPC 通道常量（按域拆分再汇总）
    ├── channels-device.ts
    ├── channels-log.ts
    ├── channels-config.ts
    └── ipc.ts                 # 请求/响应类型 + window.api 契约
```

## IPC 约定

见 `src/shared/ipc.ts`。命名空间按 `docs/architecture/01-SYSTEM-ARCHITECTURE.md` §6：
`device:*`、`log:*`；后续 `hub` / `timeline` / `capture` / `amiibo` 域在 `channels.ts`
按域文件扩展。
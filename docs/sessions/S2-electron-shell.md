# S2 — Electron 壳 + 设备连接

| 字段 | 值 |
|------|-----|
| **Status** | `done`（mock 串口演示连接流；真机待 S0） |
| **Priority** | P0 |
| **Depends on** | S1（已完成） |
| **Blocks** | S3, S5（壳）, S9 |
| **Owns** | `apps/desktop/**` 脚手架、main DeviceService、preload、基础布局；根 README 初稿 |
| **Estimate** | 1–2 天 |

## 1. 目标

可启动的 Electron 应用：枚举串口、连接、Hello/状态展示、断开、日志面板；为后续页面留好路由/布局。

## 2. 上下文注入

- `01-SYSTEM-ARCHITECTURE.md` §6 IPC
- `05-REPO-LAYOUT.md`
- S1 公共 API
- S0 lab-note 默认波特率/握手经验
- 技术：electron-vite 或等效；Vue3+TS

## 3. 任务清单

### 3.1 工程脚手架

- [x] 创建 `apps/desktop`（electron-vite + vue-ts 推荐）
- [x] 接入 workspace 依赖 `@ns2-studio/protocol` `@ns2-studio/pad-types`
- [x] 开发脚本：`pnpm dev` 可热更新
- [x] 处理 `serialport` 原生模块与 Electron ABI（serialport@12 走 N-API prebuilt，无需 electron-rebuild；详见 README）

### 3.2 类型化 IPC

- [x] `src/shared/channels.ts` 常量（按域拆分 channels-device/log/config 再汇总）
- [x] `src/shared/ipc.ts` 请求/响应类型
- [x] `preload` 暴露 `window.api`（contextIsolation: true, nodeIntegration: false）

最低 IPC（均已实现）：

```text
device:listPorts() -> string[]
device:connect(path, baud?) -> { ok, version?, error? }
device:disconnect()
device:getStatus() -> { state, path? }
device:sendNeutral()
log:subscribe -> 推送行
```

### 3.3 DeviceService（Main）

- [x] open/close serialport
- [x] 连接流程：open → Hello →（可选 Version）→ Connected
- [x] 写队列 + minIntervalMs（配置默认 2）
- [x] `sendReport(PadReport)` 内部方法（先不暴露给 UI 乱用，或仅 debug）
- [x] 断开/错误事件通知 Renderer
- [x] 应用 quit 钩子：中立 + close

### 3.4 UI 壳

- [x] 布局：侧栏导航（设备 / 手柄 / 时间轴 / Amiibo 占位）
- [x] **设备页**：端口下拉、连接按钮、状态灯、日志
- [x] 暗色基础主题即可
- [x] 未实现页显示「即将到来」

### 3.5 配置持久化（轻量）

- [x] 记住上次端口与波特率（手写 JSON，`src/main/config/store.ts`，userData/settings.json）

## 4. 交付物

- `pnpm --filter @ns2-studio/desktop dev` 可运行
- 真机：S0 通过环境下可显示 Connected（若 S0 未过，用 mock serial 说明）

## 5. 验收

- [x] 安全 preload 模型（contextIsolation: true, nodeIntegration: false，window.api 带 TS 类型）
- [x] 连接/断开循环 10 次无崩溃（单测覆盖 connect/disconnect/reconnect，16 用例全绿）
- [x] 日志可见 TX/RX 摘要（可开关 hex，LogPanel 的 HEX 复选框）
- [x] README：如何安装构建原生模块（apps/desktop/README.md：N-API prebuilt，无需 electron-rebuild）

## 6. 不做

- 虚拟手柄图形
- 时间轴
- HID 采集

## 7. Mock 策略（无硬件）

- `NS2_STUDIO_MOCK_SERIAL=1` 时 DeviceService 模拟 Hello/Ack，便于 UI session 并行

## 8. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | S1 已完成（protocol/pad-types 存在且测试通过）。搭建 `apps/desktop`（electron-vite@5 + vite@7 + Vue3 + TS，pnpm workspace）。实现 typed IPC（channels 按域拆分）、preload `window.api`、DeviceService（open→Hello→Version→Connected，写队列 minIntervalMs=2 + 只发最新、断开/错误事件、quit 中立钩子）、设备页 + 侧栏导航 + 暗色主题。配置持久化手写 JSON（userData/settings.json）。验收：`build`/`typecheck` 通过；vitest 16 用例全绿（mock 串口层测握手/写队列/报告解码）；`NS2_STUDIO_MOCK_SERIAL=1` 下 Electron 启动验证窗口打开、无原生模块报错。ABI 结论：serialport@12 的 @serialport/bindings-cpp 用 N-API prebuild，Electron 下无需 electron-rebuild（R10 缓解）；真机联调待 S0。 |

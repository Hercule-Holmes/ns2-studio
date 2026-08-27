# NS2 Studio 项目结构速览（Electron 新手向）

> 写给**不懂 Electron、但了解基本编程概念**的读者。
> 读完本文你能回答：项目里有哪些东西？谁在干什么？一次按键操作从点击到发到 Switch 经历了什么？

---

## 1. 这个项目是做什么的

一句话：**一个 PC 桌面软件（NS2 Studio），通过一根 USB 线连着的 ESP32-S3 小板子，控制 Nintendo Switch 2 自动打游戏**（挂机、录宏、回放、刷 Amiibo）。

完整链路：

```
[你的电脑]  NS2 Studio 软件
     │  USB 串口（COM 口）
[ESP32-S3]  小开发板（固件把它伪装成一个 Switch 手柄）
     │  USB
[Nintendo Switch 2]
```

软件这边（也就是本仓库）负责：给你一个界面按按钮 / 编辑时间轴 / 录制 Pro 手柄操作，然后把"按键指令"翻译成串口字节流发给小板子。

> 小板子那头是另一个项目（`F:\nstool\EasyMCU_ESP32S3` / EasyCon 固件），本仓库只管 PC 侧。

---

## 2. Electron 是什么（先搞懂这个）

**Electron = 一个"用网页技术写桌面软件"的框架。** 你用 HTML/CSS/JavaScript(或 TypeScript) 写界面，Electron 负责把它包装成一个真正的桌面应用（有窗口、有 exe）。

它是 Chrome 浏览器 + Node.js 的合体。关键点是它把程序分成**三个隔离的世界**：

```
┌─────────────────────────────────────────────────────────────┐
│ ① 主进程（Main）—— 程序的"大脑/管家"                          │
│    · 唯一的 Node.js 环境：能读写文件、开串口、操作硬件          │
│    · 管理窗口生命周期                                         │
│                                                             │
│ ② 渲染进程（Renderer）—— 你看到的"界面"                      │
│    · 就是网页（Vue 写的 UI）                                  │
│    · 出于安全被禁止直接碰文件/串口（nodeIntegration: false）    │
│                                                             │
│ ③ preload 脚本 —— 界面上唯一的小桥                           │
│    · 在主/渲染之间架一座"只开放特定通道"的桥（contextBridge）   │
└─────────────────────────────────────────────────────────────┘
```

类比：主进程是**前台**，渲染进程是**大厅**，preload 是**带门禁的窗口**。大厅的人（界面）不能直接进后台（碰串口），只能通过窗口喊话（IPC）。

### 为什么这么设计（安全）

如果界面代码能直接碰串口/文件系统，那么界面里任何一个 XSS 漏洞都能让黑客控制你的电脑。所以 Electron 的默认安全姿势就是：**界面被锁在沙盒里，只能通过"白名单 API"调用主进程能力**。

本项目的白名单就定义在 `apps/desktop/src/preload/index.ts` —— 你在界面里调用的 `window.api.device.connect(...)` 之类，全部是它转发的。

---

## 3. 仓库结构（monorepo）

本项目用 **pnpm workspace** 把多个"独立包"放在同一个仓库里（monorepo）：

```
ns2-studio/
├── docs/              # 所有设计文档（架构契约、Session 工单）★ 先看这里
├── packages/          # 共享代码库（给桌面应用用，也可独立测试）
│   ├── pad-types/     # 手柄报告类型定义（按键/摇杆/方向）
│   ├── protocol/      # PC↔ESP32 串口协议（字节编码/解码）
│   └── timeline-model/ # 时间轴工程的数据模型（校验/编译/烘焙）
├── apps/
│   └── desktop/       # 唯一的桌面应用（Electron + Vue）
├── tools/             # 小工具脚本
├── examples/          # 示例文件
├── firmware/          # 固件相关说明（计划）
└── package.json       # 根：pnpm 工作区 + 汇总命令
```

### 为什么拆包

| 包 | 类比 | 职责 |
|----|------|------|
| `pad-types` | 数据库表结构 | "手柄状态长什么样"（`PadReport`：buttons/hat/摇杆） |
| `protocol` | 网络协议库 | "怎么把状态编码成字节"（对齐 EasyCon 的 7bit 打包） |
| `timeline-model` | 文档格式规范 | "时间轴工程文件长什么样"（JSON schema、编译、烘焙） |

**契约优先原则**：这三个包是全项目唯一真相源。改任何共享类型，先改 `docs/architecture/*` 契约文档，再改代码。

### 桌面应用内部结构

```
apps/desktop/
├── src/
│   ├── main/         # 主进程：所有"干实事"的服务都在这里
│   │   ├── index.ts          # 入口：组装所有服务、开窗口
│   │   ├── device/           # 串口生命周期（连接、握手、读写队列）
│   │   ├── hub/              # InputHub：输出源仲裁（见第 5 节）
│   │   ├── timeline/         # 高精度回放引擎
│   │   ├── capture/          # NS2 Pro 手柄采集转发（node-hid）
│   │   ├── recorder/         # 录制器
│   │   ├── amiibo/           # Amiibo 库与下发
│   │   ├── config/           # 设置/配置持久化
│   │   ├── log/              # 日志与崩溃记录
│   │   └── ipc/              # 所有 IPC 通道的注册
│   ├── preload/      # 桥：把主进程能力暴露给界面（白名单）
│   ├── renderer/     # 界面（Vue3）：虚拟手柄、时间轴编辑器等
│   └── shared/       # 主/渲染共享的类型与通道名常量
├── test/             # vitest 单元测试
├── electron.vite.config.ts  # 构建配置
├── electron-builder.yml     # 打包 exe 配置
└── package.json     # 脚本：dev / build / test / dist
```

---

## 4. 一次"按下虚拟手柄 A 键"的完整旅程

这是理解整个系统流程最好的例子（对应 `docs/architecture/01` §3.1）：

```
① 渲染进程：你在界面上按 A
        │  Vue 组件更新 PadReport：{ buttons: bit2 置 1, ... }
        ▼
② preload 桥：window.api.pad.apply(report)
        │  ipcRenderer.invoke("pad:apply", report)   ← 跨进程调用
        ▼
③ 主进程：InputHub 收到请求
        │  检查自己是不是"当前活动输出源"（manual？）
        │  是 → device.sendReport(report)
        ▼
④ DeviceService 的写队列
        │  protocol.encodeReport() 把 PadReport 编码成 8 字节帧
        │  （7bit 打包 + 帧尾 0x80，与 EasyCon 固件协议一致）
        │  按最小间隔合并/发送
        ▼
⑤ serialport 写入 USB 串口 → 小板子 → Switch
        │
        ▼
⑥ 反向广播：device 发 stateChanged/log 事件 → IPC → 界面刷新状态
```

**关键规则（InputHub）**：同一时刻**只有一个输出源**能写串口（`idle` / `manual` 虚拟手柄 / `forward` Pro 转发 / `timeline` 时间轴播放）。切换源之前必须先发一个"中立报告"（松开所有按键），防止卡键。

---

## 5. 其他主要流程（速览）

| 功能 | 数据流 | 对应代码 |
|------|--------|----------|
| **虚拟手柄** | UI → preload `pad:apply` → InputHub(manual) → DeviceService → 串口 | `renderer/pad/`、`hub/input-hub.ts` |
| **时间轴播放** | UI 打开工程 → `timeline-model.compile()` → 主进程 `TimelineEngine` 用高精度时钟逐帧 → InputHub(timeline) → 串口 | `main/timeline/engine.ts` |
| **Pro 转发** | `node-hid` 读 NS2 Pro 手柄 → `ns2-pro-parser` 解析成 PadReport → InputHub(forward) → 串口（可选旁路录制） | `main/capture/` |
| **录制** | 监听 hub `reportSent` 事件 → 按帧记录 → 存成工程文件 | `main/recorder/` |
| **Amiibo** | UI 导入 .bin → 存 `userData/amiibo/` → 选槽位 → 通过设备协议分包发送 | `main/amiibo/` |

所有"读状态/订阅事件"都是同一套机制：主进程 **广播事件**（`ipcRenderer.on`），界面通过 `window.api.xxx.onXxx(cb)` 订阅。

---

## 6. IPC 通道一览（看懂界面能做什么）

通道常量定义在 `src/shared/channels*.ts`，全部按前缀分组：

| 前缀 | 功能 | 例子 |
|------|------|------|
| `device:*` | 串口连接管理 | 列出 COM 口、连接、断开、发报告 |
| `hub:*` | 输出源切换 | setSource / forceNeutral |
| `pad:*` | 虚拟手柄输入 | apply(report) / reset |
| `timeline:*` | 时间轴 | load / play / pause / seek |
| `capture:*` | Pro 采集 | list / start / stop |
| `recorder:*` | 录制 | start / stop / save |
| `amiibo:*` | Amiibo | list / import / saveToSlot |
| `settings:*` / `config:*` | 配置 | get / update |
| `log:*` | 日志流 | 主进程 → 界面滚动日志 |

---

## 7. 开发 / 构建 / 打包

```bash
pnpm install                      # 安装依赖（pnpm 工作区）

# 日常开发：热更新启动界面 + 主进程
pnpm --filter @ns2-studio/desktop dev

# 无硬件演示：用内存假串口（模拟 Hello/Version/ACK）
$env:NS2_STUDIO_MOCK_SERIAL = "1"
pnpm --filter @ns2-studio/desktop dev

# 单测（主进程逻辑，不依赖 Electron）
pnpm --filter @ns2-studio/desktop test

# 类型检查 / 仅编译 JS（产出在 out/，没有 exe！）
pnpm --filter @ns2-studio/desktop typecheck
pnpm --filter @ns2-studio/desktop build

# 打包 exe（electron-builder；国内需先设镜像环境变量）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm --filter @ns2-studio/desktop dist
# 产物：apps/desktop/release/NS2Studio-<版本>-portable.exe
```

> ⚠️ `build` ≠ `dist`：`build` 只把 TypeScript 编译成 JS（`out/` 目录）；`dist` 才会调用 electron-builder 产出可执行 exe。

数据落盘位置（主进程 `userData` 目录）：`settings.json`、`config.json`、`logs/`、`amiibo/`。

---

## 8. 最小阅读清单（按顺序）

1. `docs/architecture/00-VISION.md` — 产品是什么、不做什么
2. `docs/architecture/01-SYSTEM-ARCHITECTURE.md` — 架构图与数据流（本文件的正式版）
3. `docs/architecture/02-PROTOCOL.md` — 串口协议细节（字节级）
4. `docs/architecture/03-DATA-MODELS.md` — PadReport 与工程文件格式
5. `apps/desktop/src/main/index.ts` — 主进程入口，看"所有服务怎么组装"
6. `apps/desktop/src/preload/index.ts` — 看"界面到底能调什么"

---

## 9. 常见问题速答

| 问题 | 答案 |
|------|------|
| 为什么 UI 代码里没有串口？ | Electron 安全模型禁止渲染进程碰硬件，全部经由主进程 + preload 白名单 |
| 为什么要 InputHub？ | 防止"虚拟手柄/Pro 转发/时间轴"同时抢着写串口导致混乱 |
| 为什么主进程要在 `main/`、界面在 `renderer/`？ | 三个世界必须物理分离，构建时各自打包 |
| 为什么协议编码在 `packages/protocol` 而不是 app 里？ | 它独立于 UI 存在，可单独单测，未来固件/测试工具也能复用 |
| Mock 串口有什么用？ | 没有小板子也能跑通整个连接流程，S2 验收就是靠它 |
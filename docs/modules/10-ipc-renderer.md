# 10 — IPC 桥与渲染层

> 位置：`src/shared/`（通道常量 + 类型）、`src/preload/index.ts`（桥）、`src/main/ipc/register.ts`（绑定）、`src/renderer/`（界面）

## 1. 三端结构回顾

```
renderer（Vue 界面，沙盒内）
   │ window.api.*（contextBridge 注入，白名单）
preload（桥）
   │ ipcRenderer.invoke / on
main（register.ts 绑定 ipcMain.handle + webContents.send 广播）
```

**安全模型**：`contextIsolation: true, nodeIntegration: false, sandbox: false`；渲染进程唯一的能力来源是 `window.api`（`preload/index.ts` 的 `RendererApi`）。

## 2. 通道常量（`src/shared/channels*.ts`）

按前缀分组（`device/hub/pad/timeline/capture/recorder/amiibo/settings/config/appInfo/log/project`）。主/渲染共用同一份常量——**字符串通道名绝不手写散落**。

## 3. IPC 两种模式

| 模式 | 机制 | 用途 |
|------|------|------|
| 请求-响应 | `invoke` / `ipcMain.handle` | 所有"调用服务"（connect、play、save…） |
| 事件推送 | `webContents.send` / `ipcRenderer.on` | 主进程状态变化 → UI（stateChanged、log、time） |

**事件接线**（`register.ts` 顶部）：各服务的 `on("stateChanged")` 等统一转发到窗口；日志用 500 条环形缓冲 + 实时推送（`log:subscribe` 可取缓冲）。

## 4. 主进程服务绑定（`register.ts` 一览）

| 服务 | 绑定通道 |
|------|----------|
| DeviceService | `device:listPorts/connect/disconnect/getStatus/sendNeutral/sendReport` |
| InputHub | `hub:setSource/getState/forceNeutral`；`pad:apply`（manual 源）/`pad:reset` |
| TimelineEngine | `timeline:load/play/pause/stop/seek` + 广播 `playbackTime`/`stateChanged` |
| Recorder | `recorder:start/stop/reset/getState/open/save` |
| CaptureService | `capture:list/start/stop/getStatus` |
| ConfigStore/SettingsStore | `config:*` / `settings:*` |
| FileLogger | `log:reportError`（渲染错误入库） |
| AmiiboService | `amiibo:*`（本文不展开） |
| 文件对话框 | `project:open/save`、`recorder:open/save` 用原生 dialog |

## 5. 渲染层结构

**路由**（`router.ts`）：`NAV_ITEMS` 是导航唯一真相源 → `SidebarNav.vue` 驱动侧栏 + 路由表。

| 页面 | 关键交互 |
|------|----------|
| `DevicePage` | 枚举端口 → connect → 订阅 `stateChanged`/`log` 展示状态灯与日志流 |
| `PadPage` | 键盘/鼠标 → `PadReport` → `pad:apply`（manual 源） |
| `TimelinePage` | 打开工程 → `timeline:load` → 编辑（TimelineEditor 等组件）→ `play/stop/seek`；订阅 `playbackTime` 驱动播放头 |
| `SettingsPage` | `config:get/update` 深度补丁 |
| `RecorderPanel` | `recorder:start/stop` → 保存 nsrec → 烘焙（`renderer/recorder/bake.ts` 用 timeline-model） |

**共享状态**：`timeline/store.ts`（编辑状态）、`pad/use-pad-state.ts`、`recorder/use-replay.ts`、`config` 等组合式 API。

**错误边界**（`main.ts` + `error-boundary.ts`）：`app.config.errorHandler` + window error/unhandledrejection → `api.appInfo.reportError` → 主进程 crash.log + 全屏遮罩可重载。

## 6. 数据流示例：一次连接

```
UI 点击"连接" → api.device.connect(path)
  → invoke("device:connect") → DeviceService.connect()
  → 状态推进：connecting → handshaking → connected（每步 emit stateChanged）
  → register.ts onStateChanged → webContents.send("device:stateChanged")
  → preload subscribe → UI 状态灯更新
```

## 7. 设计要点

1. **通道名集中管理**：`channels.ts` 一份常量，杜绝主/渲染漂移。
2. **类型全链路**：`shared/ipc.ts` 定义 `RendererApi` 与所有 payload 类型，preload 实现即契约。
3. **主进程事件 → UI 单向流**：UI 从不轮询状态，全部订阅推送。
4. **对话框在主进程**：文件打开/保存用原生 dialog（渲染层无权限直接弹）。
5. **日志可回放**：订阅前已产生的日志（500 条）可补拉，UI 重载不丢历史。
# @ns2-studio/desktop 集成指南

集成约定与跨 session 边界。S2 建立了壳与类型化 IPC 模型；后续 session 按
`docs/architecture/01-SYSTEM-ARCHITECTURE.md` §6 的通道命名空间扩展共享文件
（**只增不改既有行**，避免并行 session 冲突）。

## 进程与安全模型（S2）

- `contextIsolation: true`，`nodeIntegration: false`，renderer 禁止 `require("serialport")`。
- preload 只暴露类型化 `window.api`（`src/preload/index.ts`），契约在
  `src/shared/ipc.ts`。
- 通道常量按域拆分到 `src/shared/channels-<domain>.ts`，再在 `src/shared/channels.ts`
  汇总；请求/响应类型集中放在 `src/shared/ipc.ts`。
- main 侧绑定统一在 `src/main/ipc/register.ts`（新增 handler 只追加）。
- 工作区 TS 包（`@ns2-studio/*`）随 main 打包：`electron.vite.config.ts` 的
  `externalizeDepsPlugin.exclude` 列出；若新增 main 依赖的工作区包需同步加进去。

## S5 集成说明（时间轴编辑器 UI）

### 工程文件 IPC（main `dialog` + fs）

- 通道：`src/shared/channels-timeline.ts` → `project:open`、`project:save`。
- 契约：`ProjectApi`（`src/shared/ipc.ts`）。renderer 只持有工程对象（store），
  **不碰文件系统**：
  - `project.open()` → main `showOpenDialog` + `readFile`，返回
    `{ ok, path?, content?, canceled?, error? }`，**原始文本**由 renderer 解析；
  - `project.save(path | null, content, defaultName)` → 无 path 时 `showSaveDialog`
    （默认名 `<name>.nsproj.json`）再 `writeFile`，返回 `{ ok, path?, canceled?, error? }`。
- 反序列化/校验在 renderer：`store.openFromContent()` 内调用
  `@ns2-studio/timeline-model` 的 `migrate()`（内含 `validateProject`）；非法工程抛
  `ProjectValidationError`，页面以横幅提示。
- `*.nsproj.json` 文件格式见 `docs/architecture/03-DATA-MODELS.md` §4。

### 渲染进程 store（S5 状态归属）

- 单例 `timelineStore`（`src/renderer/timeline/store.ts`，`createTimelineStore()`
  工厂可测）。工程对象存 `store.project`；每次提交式编辑（添加/删除/移动/属性/粘贴
  等）写 undo/redo 快照命令栈（上限 100），`dirty` 置位，提交后跑 `validateProject`
  刷新 `validationError`。
- 播放头状态：`store.editor.playheadMs`（仅 UI 状态，单位 ms），拖动来自 ruler /
  播放头把手 / 轨道空白处 pointer 事件；缩放 `editor.zoom`（px/s）+ 滚动
  `editor.scrollMs`；循环区 `editor.loopInMs/loopOutMs`（仅 UI）。
- **S6 复用点**：`playheadMs` 目前是 renderer 本地状态。S6 实现 Main 高分辨率时钟
  TimelineEngine 后，按 `01-SYSTEM-ARCHITECTURE.md` §6 增加 `timeline:*`（load/play/
  pause/stop/seek）与 `playback:time`（M→R，30–60fps 节流）通道；UI 播放头改绑定
  `playback:time`，拖动 seek 走 `timeline:seek(ms)`。届时 `editor.playheadMs` 语义
  保留为「最后一次已知位置」，S6 可直接接管。

### 目录归属

| 路径 | 归属 |
|------|------|
| `src/renderer/timeline/**`、`pages/TimelinePage.vue` | S5（本 session） |
| `src/main/timeline/**`、`timeline:*`/`playback:time` IPC | S6 |
| `src/main/hub/**`、`src/renderer` 手柄页 | S3 |
| `src/main/amiibo/**`、`src/renderer` Amiibo 页 | S9 |

## S7 集成说明（帧录制与烘焙）

### 录制挂载点（main）

- `src/main/recorder/recorder.ts`：`Recorder` 订阅 **InputHub 实际下发的
  report**。InputHub 在写设备路径上新增 `reportSent` 事件（`setSource` /
  `applyFrom` / `forceNeutral` 发送成功后触发，**不改变仲裁逻辑**）；
  `main/index.ts` 用 `hub.on("reportSent", cb)` 把报告接到 Recorder。
- 时间戳 `tUs` 从 `start()` 起算（单调时钟），默认压缩（相同状态不重复写）；
  `stop()` 先 `forceNeutral` 再收尾，保证录制结尾中立（bake 边沿正确、回放无卡键）。
- nsrec 读写：`src/shared/nsrec.ts`（`serializeRecording` / `parseRecording`），
  格式严格按 `docs/architecture/03-DATA-MODELS.md` §3.1（`magic: NSREC`、
  `version: 1`、`meta.source`、frames tUs 非递减）。

### IPC / preload（append-only）

- 通道：`src/shared/channels-recorder.ts` → `recorder:*`；契约 `RecordingApi`
  （`src/shared/ipc.ts`）。文件对话框复用 S5 的 open/save 模式：renderer 只持有
  解析后的 `Recording` 对象，文件 I/O 走 main `dialog` + fs。
- 渲染进程手柄页追加 `RecorderPanel`（红点录制、时长、保存/加载 `.nsrec.json`、
  回放、发送到时间轴）。

### 回放与烘焙

- 回放 **复用 S6 TimelineEngine 的帧播放路径**：`timeline.load({ frames,
  amiiboEvents: [] })`（Recording 的 frames 即 `TimedPadReport[]`）→ `timeline.play()`；
  若 S6 未就绪则回退为简单帧定时器（见 `use-replay.ts` 注释）。
- 烘焙：调 timeline-model `bake`（死区选项透传）；「最小按键时长」在 renderer
  侧过滤过短 button clips（timeline-model 无此选项）。产物经 S5
  `timelineStore.openFromContent` 设为当前工程并跳转时间轴页；「另存 .nsproj.json」
  兜底走 `project:save`。

## S6 集成说明（时间轴回放引擎）

### Main：TimelineEngine（`src/main/timeline/engine.ts`）

- 输入：`load(Project | CompileResult, { hz? })`。Project 在 Main 内按 `hz`（默认 250）
  编译；渲染器发送其内存中的 `store.project`（structured clone，纯 JSON 对象）。
- 时钟：`process.hrtime.bigint()`；`clock/schedule` 可注入（单测用假时钟）。调度选
  方案 A（固定 hz 帧数组，MVP），注释见引擎顶部；每 tick 只下发最新到期帧，天然复用
  ReportWriter「只发最新」合并策略。
- 设备接口：引擎只依赖公开合约——`hub.applyFrom('timeline', report)`、
  `hub.setSource()`、`hub.forceNeutral()`，以及 `device.isConnected` /
  `device.onStateChanged`（S2 断开事件）。**未改 hub/device 内部**。
- stop/pause 收尾：`forceNeutral()` + `setSource('idle')`（setSource 内部已先发中立，
  双保险防卡键）。
- amiiboEvents：构造引擎时注入 `changeAmiiboIndex(slot)`（接线到 S9
  `AmiiboService.changeIndex`）；未接线时引擎内 no-op log。
- 事件：`time(ms)`（30–60fps 节流）、`state(TimelinePlaybackState)`（含
  reason: end/user/device-lost/error）、`log(text)`。

### 通道与契约（追加式）

- `channels-timeline.ts` 追加 `TimelineChannels`：`timeline:load/play/pause/stop/seek`
  （R→M 请求）+ `timeline:stateChanged`/`playback:time`（M→R 事件）。
- `shared/ipc.ts` 追加 `TimelineApi`、`TimelinePlaybackState`、`TimelinePlayResult` 等；
  `RendererApi.timeline`。
- preload 追加 `window.api.timeline`（`onTime`/`onState` 订阅）；`register.ts` 追加
  timeline handler（load 的入参在主进程内按 `Project | CompileResult` 收窄）。

### Renderer 播放粘合（S6）

- 单例 `src/renderer/timeline/playback.ts`（`createPlaybackController`）：持有
  `transport: stopped|playing|paused`；`onTime` → `store.setPlayhead(ms)`（`playback:time`
  绑定播放头，`editor.playheadMs` 保留「最后一次已知位置」语义）；`onState` → 状态机
  映射（`device-lost`/`end` → stopped）。
- 播放控制：`TransportBar.vue` 播放/暂停/停止按钮 + 试播/设备断开徽标；
  `TimelinePage.vue` 未连接设备时 play → 错误横幅 + confirm 进入 dry-run（仅动播放头）；
  播放中整页只读（overlay + 工具栏禁用 + 编辑快捷键让位）。
- 拖动 seek：`TimelineEditor.vue` 的播放头拖动走 `playback.seek(ms)` →
  `timeline:seek(ms)`（引擎未加载时仅更新本地播放头）。

### 生命周期

- 引擎在 `main/index.ts` 创建（注入 hub/device 适配 + `amiibo.changeIndex`）；
  `before-quit` 先 `timeline.dispose()` 再 `device.shutdown()`。
- main 运行时依赖 `@ns2-studio/timeline-model`（引擎 `compile`、S7 nsrec magic）：
  S6 已在 `electron.vite.config.ts` 的 `externalizeDepsPlugin.exclude` 追加该包，避免
  out/main 运行时 require 到裸 TS 源码（沿用「新增 main 依赖须同步加 exclude」规则）。

## S8 集成说明（NS2 Pro 采集转发）

### 采集服务（main）

- 目录：`src/main/capture/**`（S8 所有）。`CaptureService`（`capture-service.ts`）持有
  node-hid 生命周期：枚举过滤（VID 0x057E / PID 0x2069，排除安全模式 0x2072）→ open →
  尽力 init（经 HID output report 发 §7.1 最小集，失败进 `listen-only` 模式）→ 读循环
  （4ms 超时 ≈250Hz，ReportWriter 节流）→ `hub.setSource("forward")` + `hub.applyFrom("forward", report)`。
- 停止/拔线/解析失败：仅当 hub 当前源为 `forward` 时经 `hub.setSource("idle")` 释放并中立，
  不劫持 manual/timeline；解析失败或报告长度不符 → `unsupported` 状态不发送（S8 §3）。
- 降级：node-hid native 模块**懒加载**，加载失败缓存错误，采集显示「不可用」不崩溃。
  协议/字节表细节见 `docs/lab-notes/S8-ns2pro-protocol.md`（含未决项与待真机确认清单）。

### IPC（追加式，未改既有通道）

- 通道：`src/shared/channels-capture.ts` → `capture:list/start/stop/getStatus/stateChanged`，
  已并入 `channels.ts` 聚合。
- 契约：`src/shared/ipc.ts` 追加 `CaptureApi`（list/start/stop/getStatus/onStateChanged），
  `RendererApi` 增 `capture` 字段；preload `window.api.capture` 对应接线。
- 服务注册：`src/main/index.ts` 实例化 `CaptureService(hub)`，`register.ts` 追加 handler +
  `stateChanged`/`log` 订阅（log 汇入既有设备日志面板）。

### 手柄选择 UI（S8）

- 设备页（`pages/DevicePage.vue`）新增「NS2 Pro 采集（forward）」区块：列出已枚举设备、
  开始/停止转发、状态（streaming/connecting/unsupported/error/loadError）。

## S10 集成说明（Amiibo 时间轴轨道）

S10 是薄层粘合，未新增 IPC 通道；复用了 S5 编辑栈、S6 事件钩子与 S9 下发链路。

### Renderer（S5 扩展点）

- `timeline/store.ts` 的 amiibo TrackDef 去掉 `readonly`，`addClip("amiibo")` 创建
  `{ startMs, endMs: startMs+100, slot: 0 }` 边沿 clip（endMs 仅可见宽度，compile 只看
  startMs）；`seedProject` 不预置 amiibo 轨（编辑器保留灰轨占位、按需创建）。
- slot 0–15 校验在 renderer 层：`updateClipField` slot 编辑门（0–15）+
  `runValidate` 兜底扫描（`outOfRangeAmiiboSlots`，timeline-model 仅校验 `slot >= 0`），
  越界记 `console.warn` 并横幅提示；播放前 `playback.play()` 会先跑 `store.validate()` 拦截。
- 播放预览：纯函数 `renderer/timeline/amiibo-preview.ts`（`nextAmiiboHint(project, positionMs)`），
  `TransportBar.vue` 显示 `Amiibo → SLOT{n} @ t` 徽标（播放时取 `playback.state.positionMs`，
  否则取 `editor.playheadMs`）。`NumberField.vue` 新增可选 `max` prop（槽位输入上限 15）。

### Main（S6 扩展点，最小改动）

- `main/timeline/engine.ts` `load()`：`dedupeAmiiboEvents` 把同 tUs（同毫秒）的多个事件
  折叠为最后一个（last-wins），避免重复 `ChangeAmiiboIndex`；slot 越界（0–15）事件记
  `[timeline] 警告` 日志后跳过。到点触发沿用既有 `fireAmiiboFor` + 注入的
  `changeAmiiboIndex`（`main/index.ts` 已接 S9 `AmiiboService.changeIndex`）。

### 示例工程

- `examples/amiibo-switch.nsproj.json`：按键轨（A）+ amiibo 轨（2000ms→slot 1、
  4000ms→slot 3），经 timeline-model `validateProject`/`compile` 验证。
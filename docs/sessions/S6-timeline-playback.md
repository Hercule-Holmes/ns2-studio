# S6 — 时间轴回放引擎对接设备

| 字段 | 值 |
|------|-----|
| **Status** | `done`（引擎+UI 完成；真机验收项待 NS2） |
| **Priority** | P0 |
| **Depends on** | S3, S4, S5a |
| **Blocks** | S10, M3 |
| **Owns** | `apps/desktop/src/main/timeline/**`, 播放相关 IPC, Timeline 播放按钮粘合 |
| **Estimate** | 1–2 天 |

## 1. 目标

按工程编译结果，用 **Main 高分辨率时钟** 向 InputHub（source=timeline）推送 report，驱动 NS2；UI 播放头跟随。

## 2. 上下文注入

- `01-SYSTEM-ARCHITECTURE.md` 时钟约束
- S4 `compile`
- S3 InputHub 合约

## 3. 任务清单

### 3.1 TimelineEngine（Main）

- [x] `load(project | CompileResult)`
- [x] `play()` / `pause()` / `stop()` / `seek(ms)`
- [x] 时钟：`process.hrtime.bigint()`，按 hz 或事件表调度
- [x] 每 tick：`hub.applyFrom('timeline', report)`
- [x] stop/pause 结束：`forceNeutral` + `setSource(idle|manual)` 策略写清
- [x] amiiboEvents 到点调用 DeviceService.changeAmiiboIndex（若 S9 未就绪则 no-op log）
- [x] 推送 `playback:time`（节流到 30–60fps 给 UI）

### 3.2 调度实现选择（记入代码注释）

| 方案 | 说明 |
|------|------|
| A. 固定 hz 采样帧数组 | 实现简单，内存随时长线性 |
| B. 事件列表 + 保持上一帧 | 更省；MVP 可用 A |

> 选 **A**：`compile()` 已产出等间隔 `TimedPadReport[]`，回放按 hrtime 走帧数组、
> 每 tick 只下发最新到期帧（ReportWriter 合并策略即等效）。方案 B 可后续无缝替换
> （注释见 `engine.ts` 顶部）。

### 3.3 UI 粘合

- [x] 播放/暂停/停止按钮
- [x] 播放中禁用编辑或只读（防撕扯；整页只读 overlay + 工具栏禁用 + 编辑快捷键让位）
- [x] 播放头位置绑定 `playback:time`
- [x] 未连接设备时 play → 错误提示（允许 dry-run 只动播放头）

### 3.4 性能

- [x] 写串口路径复用 DeviceService 合并策略
- [ ] 10s@250Hz 工程 CPU 可接受（实现 A 方案；真机耗时验证 → 待真机）

## 4. 验收（M3）

- [ ] 工程：每 200ms 点 A 共 10 次，NS2 可见 → **待真机**
- [ ] stop 后无卡键 → 单测覆盖（forceNeutral + setSource idle）；真机确认 **待真机**
- [ ] seek 到中部再 play 行为正确（从中部状态起）→ 单测覆盖；真机确认 **待真机**
- [ ] 播放中拔串口：引擎 stop + UI 提示 → 引擎单测覆盖（device-lost）；UI 提示横幅+徽标；真机确认 **待真机**

> 真机项依赖 NS2/串口硬件（S0 通路），本 session 无法无头执行，全部标注「待真机」。

## 5. 不做

- 录制
- 高级变速（0.5x/2x 可后置，接口可预留 rate）

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 完成 `apps/desktop/src/main/timeline/engine.ts` TimelineEngine：`load(Project\|CompileResult)`（Project 按 defaultHz=250 compile）、`play`（未连接→错误，允许 dryRun 只动播放头）、`pause`/`stop`（收尾 forceNeutral + setSource(idle)，stop 幂等回 0）、`seek`（播放中重定 loop 基准并立即应用当前帧）；时钟 `process.hrtime.bigint()` + 可注入 clock/schedule（单测用假时钟）；每 tick `hub.applyFrom('timeline', report)`，只下发最新到期帧（复用 ReportWriter 合并策略）；amiiboEvents 到点经注入的 changeAmiiboIndex 调 S9（未接线 no-op log）；`playback:time` 节流 16ms(60fps)/tick 上限 33ms(30fps)；设备断开→reason=device-lost 自动 stop。调度方案 A（固定 hz 帧数组）MVP，注释说明。IPC：channels-timeline.ts 追加 `TimelineChannels`（timeline:load/play/pause/stop/seek + timeline:stateChanged + playback:time）；ipc.ts 追加 TimelineApi/状态类型；preload/register/main wiring 追加式接入（未改既有行）。`electron.vite.config.ts` 的
main `externalizeDepsPlugin.exclude` 追加 `@ns2-studio/timeline-model`（S6 起 main 运行时
依赖其 `compile`/magic 常量；不追加会导致 out/main 在运行时 require 到裸 TS 源码）。UI：renderer `timeline/playback.ts` 播放控制器（onTime→setPlayhead、onState→传输态映射）；TransportBar 播放/暂停/停止按钮+试播/设备断开徽标；TimelinePage 播放中整页只读 overlay+工具栏禁用+编辑快捷键让位；未连接 play→错误提示+确认试播；拖动 seek 走 timeline:seek。验收：`pnpm -r test` 全绿（新增 timeline-engine 单测 14 例：帧序列/seek 中部起播/stop 幂等/device-lost/pause 收尾/amiibo no-op 与 S9 钩子/加载中停止等）；desktop `build` + `typecheck` 通过。并行 S7/S8 文件冲突：全程只对共享文件做追加式修改；一次 `pnpm -r test` 中 S8 的 ns2-pro-parser 单测出现瞬时失败、二次运行全绿，判定与 S6 无关。 |

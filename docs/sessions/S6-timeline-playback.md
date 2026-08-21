# S6 — 时间轴回放引擎对接设备

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S3, S4, S5a） |
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

- [ ] `load(project | CompileResult)`
- [ ] `play()` / `pause()` / `stop()` / `seek(ms)`
- [ ] 时钟：`process.hrtime.bigint()`，按 hz 或事件表调度
- [ ] 每 tick：`hub.applyFrom('timeline', report)`
- [ ] stop/pause 结束：`forceNeutral` + `setSource(idle|manual)` 策略写清
- [ ] amiiboEvents 到点调用 DeviceService.changeAmiiboIndex（若 S9 未就绪则 no-op log）
- [ ] 推送 `playback:time`（节流到 30–60fps 给 UI）

### 3.2 调度实现选择（记入代码注释）

| 方案 | 说明 |
|------|------|
| A. 固定 hz 采样帧数组 | 实现简单，内存随时长线性 |
| B. 事件列表 + 保持上一帧 | 更省；MVP 可用 A |

### 3.3 UI 粘合

- [ ] 播放/暂停/停止按钮
- [ ] 播放中禁用编辑或只读（防撕扯；可先整页只读）
- [ ] 播放头位置绑定 `playback:time`
- [ ] 未连接设备时 play → 错误提示（可允许 dry-run 只动播放头）

### 3.4 性能

- [ ] 写串口路径复用 DeviceService 合并策略
- [ ] 10s@250Hz 工程 CPU 可接受

## 4. 验收（M3）

- [ ] 工程：每 200ms 点 A 共 10 次，NS2 可见
- [ ] stop 后无卡键
- [ ] seek 到中部再 play 行为正确（从中部状态起）
- [ ] 播放中拔串口：引擎 stop + UI 提示

## 5. 不做

- 录制
- 高级变速（0.5x/2x 可后置，接口可预留 rate）

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

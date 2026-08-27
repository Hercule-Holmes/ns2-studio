# 06 — timeline-engine：主进程回放引擎

> 位置：`apps/desktop/src/main/timeline/engine.ts`
> 职责：在**主进程**用高精度时钟驱动编译后的帧流，按时间把报告交给 InputHub（timeline 源），并广播播放头时间。

## 1. 调度方案（scheme A：定长帧数组）

- `compile()` 已产出等间隔采样帧流 → 回放只需"按墙钟走数组"：
  - 每个 tick 用 `process.hrtime.bigint()` 计算 `targetUs = startPosUs + elapsedUs`
  - **只应用"最新一条到期帧"**（`frameIndexAt` 二分查找 + `idx > frameIndex` 判断）
  - 依赖 ReportWriter 的"只发最新"合并——中间帧天然折叠，不排队
- 帧稀疏时以 `TICK_CAP_MS=33ms`（30fps）为下限保底推进，播放头时间仍流动

## 2. 状态机

```
load(Project|CompileResult) ──▶ loaded（编译/接收帧流，清理播放中状态）
play({dryRun}) ──▶ playing     （claim timeline 源，立即推当前帧避免空档）
pause() / stop() / seek(ms) ──▶ 停止/跳转
finish(reason) ──▶ 收尾：forceNeutral() + setSource("idle")（双保险防卡键）
```

| 结束原因 | 触发 |
|----------|------|
| `end` | 播放到 `durationUs`（先补最后一帧） |
| `user` | pause/stop/加载中切走 |
| `device-lost` | 播放中设备状态 ≠ connected |
| `error` | 异常 |

**dryRun**：仅移动播放头 + 广播时间，不写设备（UI 试播）。

## 3. 时间精度与节流

| 机制 | 值 | 目的 |
|------|-----|------|
| 时钟 | `process.hrtime.bigint()`（ns） | 主进程高精度，不受 GC/rAF 影响 |
| `TIME_THROTTLE_NS` | 16ms（60fps 上限） | `playback:time` 广播节流 |
| `TICK_CAP_MS` | 33ms（30fps 下限） | 稀疏帧间保持时间流动 |
| 下一次调度 | `min(max(下一帧到期-当前, 1), 33)` ms | 对齐帧边界 |

**seek 在播放中**：重置 loop 基准（`startWallNs`/`startPosUs`/`frameIndex`），立即应用目标帧并 `scheduleTick(0)`。

## 4. Amiibo 事件触发（S10 薄层）

- `load` 时排序 + 校验 slot 0..15（越界跳过并记日志）+ 同 tUs **last-wins 去重**（边沿语义）
- `fireAmiiboFor`：游标 `amiiboIndex` 逐事件触发 `changeAmiiboIndex(slot)`；未接线（S9 前）→ no-op 日志
- `seek` 时游标同步回退（`amiiboIndexAt`）

## 5. 外部契约（接口注入，全部可单测）

```ts
TimelineHub   { applyFrom(source, report); setSource(source); forceNeutral() }
TimelineDevice{ isConnected; onStateChanged(cb) }
TimelineClock { nowNs(): bigint; schedule(cb, ms): cancel }   // 默认 hrtimeClock
changeAmiiboIndex?(slot)
```

## 6. 设计要点

1. **事件驱动而非定时器风暴**：tick 按"下一帧到期时间"调度，间隔自适应 1..33ms。
2. **最后帧必达**：播放结束前补发最后一帧（防止结尾状态缺失）。
3. **写设备走 hub**：引擎从不直接碰 DeviceService，切源/中立语义全部由 hub 保证。
4. **设备断线即停**：`device.onStateChanged` 在播放中非 connected → `finish("device-lost")`。
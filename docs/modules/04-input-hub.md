# 04 — input-hub：输出源仲裁

> 位置：`apps/desktop/src/main/hub/input-hub.ts`
> 职责：**整个应用唯一向设备写报告的入口**，保证"同一时刻只有一个输出源"。

## 1. 为什么需要它

虚拟手柄、Pro 转发、时间轴播放都可能产生报告。如果没有仲裁，三者会互相覆盖/抢写串口，造成按键错乱甚至卡键。InputHub 用**活动源互斥**解决。

## 2. 输出源（`HubSource`）

| 源 | 触发方 | 含义 |
|----|--------|------|
| `idle` | 默认 | 无活动源 |
| `manual` | 虚拟手柄（`pad:apply`） | 用户手动操作 |
| `forward` | CaptureService | NS2 Pro 手柄转发 |
| `timeline` | TimelineEngine | 时间轴回放 |

## 3. 核心逻辑（33 行主逻辑）

```ts
async setSource(source) {           // 切源
  if (source === this.active) return;
  await this.device.sendReport(NEUTRAL_REPORT);   // ★ 先发中立，防卡键
  this.active = source;
  emit("stateChanged");
}

async applyFrom(source, report) {   // 写报告的唯一通道
  if (source !== this.active) return;   // 非活动源：直接丢弃
  await this.device.sendReport(report);
  emit("reportSent", report);           // 录制器钩子
}

async forceNeutral() {              // 强制中立（录制停止/播放结束等）
  await this.device.sendReport(NEUTRAL_REPORT);
  emit("reportSent", NEUTRAL_REPORT);
}
```

## 4. 事件

| 事件 | 消费者 |
|------|--------|
| `stateChanged` | IPC → UI（当前源展示） |
| `reportSent` | Recorder（录制**实际发出**的报告） |

**防呆**：设备断开时 `device.stateChanged` 监听自动把活动源拉回 `idle`（防呆：设备没了源必须复位）。

## 5. 使用方接入点

| 场景 | 调用 |
|------|------|
| 虚拟手柄 | `hub.applyFrom("manual", report)`（经 `pad:apply` IPC） |
| Pro 转发 | CaptureService：`setSource("forward")` → 循环 `applyFrom("forward", ...)` |
| 时间轴 | TimelineEngine：播放 `setSource("timeline")`，结束 `forceNeutral() + setSource("idle")` |
| 停止/退出 | 各服务统一走 `setSource("idle")`（内部先中立） |

## 6. 设计要点

1. **切源必中立**：`setSource` 内部强制先发 `NEUTRAL_REPORT`——任何路径都不会带着旧按键切源。
2. **非活动源静默丢弃**：被抢占的调用方继续 `applyFrom` 是无害 no-op（例如引擎结束竞态）。
3. **录制挂在实际发送路径**：录的是"发出去的"而非"请求的"，杜绝请求被合并丢弃造成的假帧。
4. **薄封装**：不持有协议/串口细节，只做仲裁与事件；`test/input-hub.test.ts` 覆盖全部路径。
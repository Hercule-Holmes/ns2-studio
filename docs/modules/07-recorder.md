# 07 — recorder：帧录制器（S7）

> 位置：`apps/desktop/src/main/recorder/recorder.ts`
> 职责：录制"**实际发送到设备**"的报告流，带单调时间戳，输出 `nsrec` 录制文件。

## 1. 数据源（关键设计）

录制器**不直接监听输入**，而是订阅 `InputHub` 的 `reportSent` 事件：

```ts
const recorder = new Recorder(
  { onReport: (cb) => hub.on("reportSent", cb), forceNeutral: () => hub.forceNeutral() },
  { deviceName: "NS2 Pro" },
);
```

- 录的是**真正发出去的**报告（虚拟手柄 / Pro 转发 / 时间轴都走 hub）
- `reportSent` 在 hub 写设备路径上触发，与仲裁逻辑零耦合

## 2. 状态与流程

```
start(source) ──▶ recording（清空帧、记录 startUs、订阅 onReport）
stop()         ──▶ 先 forceNeutral()（防止停止时按键卡住）→ 取消订阅 → 生成 Recording
reset()        ──▶ 直接回 idle（不强制中立）
```

**录制标签** `source ∈ { forward, manual, timeline }` 记录来源，烘焙时可提示。

## 3. 时钟与压缩

| 机制 | 说明 |
|------|------|
| 时钟 | `RecorderClock.nowUs()`，默认 `performance.now()*1000`（单调微秒） |
| 时间戳 | `tUs = max(0, nowUs - startUs)` |
| 压缩 | 默认开：**连续相同报告跳过**（`sameReport` 比较 6 字段）——回放侧按"保持上一帧"语义，帧量大幅减少 |

## 4. 输出格式

```ts
Recording {
  magic: "NSREC", version: 1,
  meta: { createdAt, source, deviceName, tickHz(默认250) },
  frames: TimedPadReport[],        // tUs 严格非递减
}
```

序列化/解析在 `src/shared/nsrec.ts`（`serializeRecording`/`parseRecording`，含 magic/version/排序校验），保存为 `.nsrec.json`。

## 5. 与烘焙的关系

`Recorder` → `Recording` → `bake()`（timeline-model）→ `Project` → 编辑器再编辑/再编译回放。**录制→编辑→回放闭环**。

## 6. 设计要点

1. **录真实输出**：合并队列把报告折叠后，`reportSent` 只在"真正写设备"时触发。
2. **停止必中立**：`stop()` 强制先 `forceNeutral()`，中立报告也会流经 `onReport` 成为最后一条帧。
3. **压缩无信息损失**：回放引擎"保持上一帧"语义与压缩互补。
4. **全注入可测**：时钟与报告源都是构造函数参数，`test/recorder.test.ts` 无 Electron 依赖。
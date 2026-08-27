# 05 — timeline-model：时间轴数据模型包

> 位置：`packages/timeline-model/src/`（`types.ts`、`validate.ts`、`compile.ts`、`bake.ts`、`migrate.ts`、`errors.ts`）
> 职责：时间轴工程（Project）与录制（Recording）的文件格式、校验、编译、烘焙。纯函数，无 Electron 依赖。

## 1. 文件格式（`types.ts`）

### 1.1 工程文件 `Project`（magic `NSPROJ` v1）

```
Project { name, durationMs, gridMs, tracks[] }
Track 类型（联合）：
  buttons: clips[] { id, key(按键名), startMs, endMs }
  stick:   stick(L|R), clips[] { id, startMs, endMs, keyframes[] {offsetMs,x,y} }
  hat:     clips[] { id, startMs, endMs, hat }
  amiibo:  clips[] { id, startMs, endMs, slot }     ← 本包支持，文档范围不含 amiibo 服务
  marker:  clips[] { id, startMs, endMs, label }
```

### 1.2 录制文件 `Recording`（magic `NSREC` v1）

```
Recording { meta{createdAt, source(forward|manual|timeline), deviceName, tickHz}, frames[] }
frames: TimedPadReport[]（tUs 微秒，严格非递减）
```

`CompileResult = { frames: TimedPadReport[], amiiboEvents: AmiiboEvent[] }`。

## 2. 校验（`validate.ts`）

- `validateProject(project)`：抛出 `ProjectValidationError`（带 `path` 定位）；校验轨道/clip 结构、时间区间、按键名合法性、stick keyframes 排序等
- `hatConflictWarnings(project)`：HAT 轨道重叠冲突**警告**（非致命）

## 3. 编译（`compile.ts`）——工程 → 帧流

`compile(project, { hz })` 输出**等间隔采样帧流**（步长 `1000/hz` ms，覆盖 `[0, durationMs]`）：

| 轨道 | 编译策略 |
|------|----------|
| buttons | `startMs ≤ t < endMs` 区间内 OR 进位图 |
| stick | 区间内按 keyframes **线性插值**（`lerpStick`），clamp 到 0..255 |
| hat | 区间内覆盖（后写先赢） |
| amiibo | 转成 `{ tUs: startMs*1000, slot }` 事件 |

**产物语义**：`TimedPadReport.tUs = tMs * 1000`（微秒）——回放引擎按此推进（见 06）。

## 4. 烘焙（`bake.ts`）——录制 → 工程（S7）

`bake(recording, opts)` 从录制帧流反推工程：

- **按键**：边沿检测（pressed 上升沿开始、下降沿结束）→ `ButtonClip`；未松开到末尾的补到 `durationMs`
- **摇杆**：可选 `stickDecimation` 降采样 + `deadZone`（|v-128| < d 视为 128）→ 去重相邻相同点 → `StickClip` keyframes；全中立则不生成轨道
- 严格校验帧流（magic/version/非递减 tUs），失败抛 `ProjectValidationError`

## 5. 其他

- `migrate.ts`：`migrate(project)` 版本迁移、`createEmptyProject(name)` / `emptyProject`
- `errors.ts`：`ProjectValidationError`（带 path 的错误类型）
- 序列化：nsrec 的 JSON 化在 `apps/desktop/src/shared/nsrec.ts`（`serializeRecording` / `parseRecording`，主/渲染共用）

## 6. 设计要点

1. **编译是纯函数**：`hz` 入参显式传入，便于测试与复用（引擎可编译任意 hz）。
2. **帧流 vs 事件**：帧流统一采样（回放简单），Amiibo 用事件表（边沿触发，避免同毫秒重复）。
3. **烘焙是编译的逆过程**：录制→工程→再编译，保证"录制可回放、可再编辑"闭环。
4. **错误可定位**：所有校验错误带字段路径，UI 可精确提示。
# S4 — timeline-model（工程 schema + 编译 + 烘焙）

| 字段 | 值 |
|------|-----|
| **Status** | `done` |
| **Priority** | P0 |
| **Depends on** | S1 |
| **Blocks** | S5, S6, S7 |
| **Owns** | `packages/timeline-model/**` |
| **Estimate** | 1–2 天 |

## 1. 目标

纯数据层：工程类型、Zod/校验、`compile` 为 `TimedPadReport[]`、`bake` 从录制生成工程；**无 UI、无串口**。

## 2. 上下文注入

- `03-DATA-MODELS.md` 全文
- `pad-types` API

## 3. 任务清单

- [ ] `Project` / `Track` / `Clip` 类型与 `version: 1`
- [ ] `validateProject`: 时间倒挂、未知 key、id 冲突
- [ ] `compile(project, { hz })`:
  - buttons 位或
  - stick 关键帧线性插值
  - hat 区间
  - amiibo clips → 旁路事件列表 `AmiiboEvent[]`（不要塞进 PadReport）
- [ ] `emptyProject(name)`
- [ ] `bake(recording, opts)` MVP：
  - 按键边沿 → button clips
  - 摇杆可选降采样（简单步进也可）
- [ ] `migrate` 占位（v1 identity）
- [ ] 单测：
  - 单 A clip 100–180ms @100Hz 的帧 buttons 模式
  - 两键重叠
  - stick 从中心到上
  - 非法工程抛错信息稳定

### 编译输出建议

```ts
interface CompileResult {
  frames: TimedPadReport[]; // 或紧凑 run-length
  amiiboEvents: { tUs: number; slot: number }[];
}
```

## 4. API 冻结

```ts
export function validateProject(p: unknown): Project // throws or Result
export function compile(p: Project, opts: { hz: number }): CompileResult
export function bake(rec: Recording, opts?: BakeOptions): Project
export function createEmptyProject(name: string): Project
```

## 5. 验收

- [ ] vitest 全绿
- [ ] 不依赖 electron/fs（bake/compile 纯函数；读文件在 app 层）

## 6. 不做

- Canvas 编辑器
- 播放时钟

## 7. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 完成 `packages/timeline-model`：Project/Track/Clip schema（version 1）、`validateProject`（时间倒挂/未知 key/id 冲突等稳定错误码）、`compile`（buttons 位或、stick 线性插值、hat 后写覆盖、amiibo 旁路事件）、`bake` MVP（按键边沿→clips、摇杆降采样+死区）、`migrate` v1 identity、`createEmptyProject`。vitest 22 用例全绿；`tsc -p tsconfig.json` 通过；仅依赖 `@ns2-studio/pad-types`，无 electron/fs/serialport。 |

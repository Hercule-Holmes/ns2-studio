# S10 — Amiibo 时间轴轨道

| 字段 | 值 |
|------|-----|
| **Status** | `done` |
| **Priority** | P1 |
| **Depends on** | S5, S6, S9 |
| **Blocks** | M5 |
| **Owns** | 时间轴 amiibo 轨 UI + Engine 触发粘合（薄层） |
| **Estimate** | 0.5–1 天 |

## 1. 目标

在时间轴放置「切换槽位」clip，回放时在指定时刻调用 `ChangeAmiiboIndex`。

## 2. 任务清单

- [x] S5 若灰轨：启用创建/编辑 `type: amiibo` clips（startMs + slot）
- [x] 校验 slot 0–15（自己层补：timeline-model 仅校验 >= 0；编辑门 + validate 门 + engine 兜底日志）
- [x] 确认 S4 compile 输出 `amiiboEvents`（已由 S4 提供并被 S6 消费）
- [x] S6 Engine：到点触发；同一毫秒去重（load 时 last-wins 折叠，测试覆盖）
- [x] 播放预览：UI 显示将切换的 slot 提示（TransportBar 徽标 + 纯函数 nextAmiiboHint）
- [x] 文档示例工程：`examples/amiibo-switch.nsproj.json`

## 3. 验收

- [x] 回放时日志/设备侧可见切换命令序列（engine 单测覆盖：到点调用 changeAmiiboIndex、同毫秒去重、未接线 no-op 日志；真机待 S0 硬件）
- [x] 与按键轨同时存在不冲突（compile 旁路事件 + engine 独立事件游标，单测覆盖）

## 4. 不做

- 在时间轴内嵌 Save 大包传输（Save 保持库页面操作）

## 5. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 完成 amiibo 轨薄层粘合（Owns：apps/desktop 时间轴 amiibo 轨 + Engine 触发）。**S5 灰轨启用**：`renderer/timeline/store.ts` 去掉 amiibo TrackDef 的 `readonly`，`addClip("amiibo")` 创建 `{startMs, endMs: startMs+100, slot: 0}` 边沿 clip（endMs 仅可见宽度，compile 只看 startMs）；`seedProject` 改为排除 amiibo 轨（按需创建，保持默认工程形态不变）。**slot 0–15 校验（自己层补）**：timeline-model `validateAmiiboClip` 只查 `slot >= 0`，故在 store 补两层——`updateClipField` slot 编辑门（0–15，`MAX_AMIIBO_SLOT`=15）与 `runValidate` 兜底扫描（`outOfRangeAmiiboSlots`），越界 `console.warn` 记日志并横幅提示；PropertyPanel 槽位 NumberField 加 `:max=15`（NumberField 新增 max prop）。**Engine（S6 最小改动）**：`load` 内新增 `dedupeAmiiboEvents`（同 tUs 即同毫秒，last-wins 折叠，避免重复 ChangeAmiiboIndex），并对 slot 越界事件记 `[timeline] 警告` 日志后跳过；到点触发沿用 S6 `fireAmiiboFor` + `changeAmiiboIndex`（main/index.ts 已接 S9 `AmiiboService.changeIndex`），S4 compile 输出 `amiiboEvents` 已确认被消费。**播放预览**：新增纯函数 `renderer/timeline/amiibo-preview.ts`（`nextAmiiboHint`），TransportBar 显示 `Amiibo → SLOT{n} @ t` 徽标（播放时取 playback 位置，否则取播放头）。**示例工程**：新建 `examples/amiibo-switch.nsproj.json`（按键轨 A + amiibo 轨切换 slot 1/3）。新增单测 10 例：timeline-engine 同毫秒去重 + 越界跳过（2）、timeline-store amiibo 创建/编辑/越界/复制粘贴（5）、amiibo-preview（4）。改动文件均在 apps/desktop（Owns 内）；未动 packages/**、tools/**、docs/architecture/**。验收：`pnpm -r test` 全绿（186 例，desktop 139）；`--filter @ns2-studio/desktop build` 与 `typecheck` 通过。注：工单验收命令 `npm -r test`/`npm --filter ... build` 在本仓库实为 pnpm 命令（root script 即 `pnpm -r test`），以 pnpm 等价实跑。 |

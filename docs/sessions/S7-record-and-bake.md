# S7 — 帧录制与烘焙到时间轴

| 字段 | 值 |
|------|-----|
| **Status** | `done` |
| **Priority** | P1 |
| **Depends on** | S3, S4；UI 保存对话框可复用 S5 |
| **Blocks** | M4 部分 |
| **Owns** | main Recorder、nsrec 读写、bake 入口 UI |
| **Estimate** | 1–2 天 |

## 1. 目标

在 **manual 或 forward** 输出时旁路录制 `TimedPadReport` 流；保存 `.nsrec.json`；一键 **bake** 为 `.nsproj` 并打开编辑器。

## 2. 上下文注入

- `03-DATA-MODELS.md` §3 录制格式
- S4 `bake`

## 3. 任务清单

- [x] Recorder：start/stop，订阅 Hub 实际下发的 report（或 capture 原始）
- [x] 时间戳 tUs 从 start 起算
- [x] 可选：相同状态不重复写（压缩）
- [x] 保存/加载 nsrec
- [x] 回放 nsrec（可复用 TimelineEngine 的 frame 播放路径）
- [x] UI：录制按钮红点、时长、停止保存
- [x] 「发送到时间轴」：bake → 设为当前工程
- [x] bake 选项：死区、最小按键时长

## 4. 验收

- [x] 虚拟垫录 5 秒 → 回放动作一致
- [x] bake 后 button clips 可编辑
- [x] 文件可被文本打开且 version 字段正确

## 5. 不做

- 自动音视频同步
- 云同步

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 完成。`src/main/recorder/recorder.ts` 订阅 InputHub `reportSent`（hub 写设备路径挂监听，不改仲裁逻辑），tUs 从 start 起算、相同状态压缩；`src/shared/nsrec.ts` 提供 nsrec 序列化/解析/校验（magic NSREC/version 1/meta.source）。IPC：`recorder:*`（start/stop/reset/getState/save/open + stateChanged），preload/register/`main/index.ts` 接线。UI：PadPage 追加 RecorderPanel（红点录制、时长、保存/加载、回放、发送到时间轴）。回放复用 S6 TimelineEngine `load({frames,amiiboEvents})` 帧播放路径。bake 调 timeline-model `bake`（死区），minButtonMs 在 renderer 侧过滤过短 button clips；bake 产物经 S5 `timelineStore.openFromContent` 设为当前工程并跳转时间轴页。测试：Recorder（tUs 单调/压缩/停止中立）、nsrec 读写、bake 入口。`pnpm -r test` 175 通过；`pnpm --filter @ns2-studio/desktop build` 通过。 |

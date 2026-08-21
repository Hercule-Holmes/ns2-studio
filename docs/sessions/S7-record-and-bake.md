# S7 — 帧录制与烘焙到时间轴

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S3, S4） |
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

- [ ] Recorder：start/stop，订阅 Hub 实际下发的 report（或 capture 原始）
- [ ] 时间戳 tUs 从 start 起算
- [ ] 可选：相同状态不重复写（压缩）
- [ ] 保存/加载 nsrec
- [ ] 回放 nsrec（可复用 TimelineEngine 的 frame 播放路径）
- [ ] UI：录制按钮红点、时长、停止保存
- [ ] 「发送到时间轴」：bake → 设为当前工程
- [ ] bake 选项：死区、最小按键时长

## 4. 验收

- [ ] 虚拟垫录 5 秒 → 回放动作一致
- [ ] bake 后 button clips 可编辑
- [ ] 文件可被文本打开且 version 字段正确

## 5. 不做

- 自动音视频同步
- 云同步

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

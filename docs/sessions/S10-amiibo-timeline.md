# S10 — Amiibo 时间轴轨道

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S5, S6, S9） |
| **Priority** | P1 |
| **Depends on** | S5, S6, S9 |
| **Blocks** | M5 |
| **Owns** | 时间轴 amiibo 轨 UI + Engine 触发粘合（薄层） |
| **Estimate** | 0.5–1 天 |

## 1. 目标

在时间轴放置「切换槽位」clip，回放时在指定时刻调用 `ChangeAmiiboIndex`。

## 2. 任务清单

- [ ] S5 若灰轨：启用创建/编辑 `type: amiibo` clips（startMs + slot）
- [ ] 校验 slot 0–15
- [ ] 确认 S4 compile 输出 `amiiboEvents`
- [ ] S6 Engine：到点触发；同一毫秒去重
- [ ] 播放预览：UI 显示将切换的 slot 提示
- [ ] 文档示例工程：`examples/amiibo-switch.nsproj.json`

## 3. 验收

- [ ] 回放时日志/设备侧可见切换命令序列
- [ ] 与按键轨同时存在不冲突

## 4. 不做

- 在时间轴内嵌 Save 大包传输（Save 保持库页面操作）

## 5. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

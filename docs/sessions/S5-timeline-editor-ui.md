# S5 — 时间轴编辑器 UI

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S2 壳 + S4 模型） |
| **Priority** | P0 |
| **Depends on** | S2, S4 |
| **Blocks** | S6, S10 |
| **Owns** | `apps/desktop/src/renderer/**/timeline/**`, TimelinePage |
| **Estimate** | 3–5 天（可拆 S5a/S5b） |

## 1. 目标

DAW 风格时间轴：**可编辑**工程并与 `timeline-model` 双向绑定；本 Session **不要求**真机回放（可用预览条模拟播放头）。

## 2. 上下文注入

- `03-DATA-MODELS.md` 工程 JSON
- S4 导出 API
- UX：网格吸附、缩放、播放头

## 3. 分阶段（强烈建议拆 session 时按此切）

### S5a — MVP（先做完即可进 S6）

- [ ] 轨道列表：至少 `buttons` 一轨 + 添加按键 clip
- [ ] 时间尺 + 缩放（wheel）+ 水平滚动
- [ ] clip 拖拽移动、拖拽改 end、选中删除
- [ ] 播放头拖动（仅 UI 状态）
- [ ] 工具栏：新建/打开/保存 `.nsproj.json`（经 main `dialog` + fs）
- [ ] 属性面板：clip 的 key、start、end 数字编辑
- [ ] 调用 `validateProject`，错误提示

### S5b — 完整编辑

- [ ] stick 轨 + 简易关键帧（两点线段即可）
- [ ] hat 轨
- [ ] marker 轨
- [ ] 多选、复制粘贴、undo/redo（命令栈）
- [ ] 吸附 gridMs、磁吸播放头
- [ ] 循环区（loop in/out）UI 状态

## 4. 技术建议

- 渲染：单 Canvas 或 HTML+绝对定位；注意虚拟化长工程
- 状态：工程对象在 renderer store；保存时序列化
- **不要**在 UI 线程 compile 超大工程同步卡死；compile 可 web worker 或交给 main（S6）

## 5. 验收

### S5a

- [ ] 创建「A 按 3 次」工程，保存 → 重启应用 → 打开一致
- [ ] 校验非法 end<start 有提示

### S5b

- [ ] 含摇杆片段的工程可编辑保存
- [ ] undo 可用

## 6. 不做

- 串口下发（S6）
- bake UI（S7）
- Amiibo 轨完善（S10，可先占位灰轨）

## 7. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

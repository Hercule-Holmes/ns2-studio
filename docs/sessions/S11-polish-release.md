# S11 — 打磨与发布

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S6 主路径） |
| **Priority** | P2 |
| **Depends on** | S6； ideally S7–S10 大部完成 |
| **Owns** | 设置页、关于、electron-builder、用户 README、图标 |
| **Estimate** | 1–2 天 |

## 1. 目标

可分发给自己（及未来用户）的 Windows 构建；配置项收敛；崩溃与日志可定位。

## 2. 任务清单

- [ ] 设置页：串口间隔、波特率、转发 hz、扳机阈值、swap ABXY、网格 ms
- [ ] 全局错误边界与 main crash 日志文件
- [ ] 自动上次工程恢复（可选）
- [ ] `electron-builder` portable + nsis（其一即可）
- [ ] 应用图标与名称 **NS2 Studio**
- [ ] 根 `README.md`：接线、刷固件链接、开发启动、使用概览
- [ ] 许可证与第三方 notice（EasyCon 协议兼容声明、GPL 注意：若链 GPL 固件文档需合规说明）
- [ ] 版本号 semver 与 about 对话框

## 3. 验收

- [ ] 干净 Windows 机器（或新目录）跑打包产物可连接设备
- [ ] README 按步骤可完成 M2 级操作

## 4. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

# 07 — 风险登记册

> 各 Session 发现新风险请追加行，并改 Status。

| ID | 风险 | 影响 | 可能性 | 缓解 | 状态 |
|----|------|------|--------|------|------|
| R1 | EasyCon ESP32 固件 NS2 不识别 | 阻塞全部真机 | 中 | S0 验证；S0b fork 固件 | open |
| R2 | DevKitC-1 双 USB 角色/接线错误 | S0 失败 | 中 | 严格按 EasyMCU 文档；lab-note | open |
| R3 | NS2 Pro HID 报告非公开/与 NS1 不同 | S8 失真 | 中 | 先 XInput/通用手柄；USB 抓包 | open |
| R4 | 时间轴 UI 工作量爆炸 | M3 延期 | 高 | S5 分 MVP（仅 button 轨） | open |
| R5 | Electron GC/抖动导致回放不稳 | 手感差 | 中 | 时钟与写串口在 Main；合并 report | open |
| R6 | Amiibo 固件未启用 | S9 降级 | 中 | 能力探测；UI 禁用 | open |
| R7 | 多 session 改公共 API 冲突 | 集成碎 | 中 | 目录所有权 + 契约文档 | open |
| R8 | 法律/账号风险（在线） | 产品定位 | 低 | 文档声明仅单机 | accepted |
| R9 | 7bit 对拍与 C# 不一致 | 全链路失灵 | 低 | S1 固定向量 | open |
| R10 | serialport 原生模块 Electron ABI | S2 构建失败 | 中 | electron-rebuild；或 napi 延后 | open |

## 升级路径

- **P0 阻断**（R1）：停 S5 美化，只保留 S0b + S1/S2 最小路径。
- **S8 受阻**：用 Xbox 手柄走 XInput 完成转发演示，Pro 专用解析单列。
- **S9 受阻**：时间轴预留 amiibo 轨，设备页显示「固件不支持」。

## 决策日志（短）

| 日期 | 决策 |
|------|------|
| 2026-08-21 | 新建协议兼容项目 + Electron + 时间轴；先 PC→NS2 |
| 2026-08-21 | 多 session 文档化落地于 `ns2-studio/docs` |

# 07 — 风险登记册

> 各 Session 发现新风险请追加行，并改 Status。

| ID | 风险 | 影响 | 可能性 | 缓解 | 状态 |
|----|------|------|--------|------|------|
| R1 | EasyCon ESP32 固件 NS2 不识别 | 阻塞全部真机 | 中 | S0 验证；S0b fork 固件 | open |
| R2 | DevKitC-1 双 USB 角色/接线错误 | S0 失败 | 中 | 严格按 EasyMCU 文档；lab-note | open |
| R3 | NS2 Pro HID 报告与 NS1 不同（初始化握手、12-bit 摇杆、C 键） | S8 失真 | 低 | 报告格式已公开：按 [ndeadly/switch2_controller_research](https://github.com/ndeadly/switch2_controller_research)（`hid_reports.md` 报告 0x09、`commands.md` 初始化）解析，实机复核 | open |
| R4 | 时间轴 UI 工作量爆炸 | M3 延期 | 高 | S5 分 MVP（仅 button 轨） | open |
| R5 | Electron GC/抖动导致回放不稳 | 手感差 | 中 | 时钟与写串口在 Main；合并 report | open |
| R6 | Amiibo 固件未启用 | S9 降级 | 中 | 能力探测；UI 禁用 | open |
| R7 | 多 session 改公共 API 冲突 | 集成碎 | 中 | 目录所有权 + 契约文档 | open |
| R8 | 法律/账号风险（在线） | 产品定位 | 低 | 文档声明仅单机 | accepted |
| R9 | 7bit 对拍与 C# 不一致 | 全链路失灵 | 低 | S1 固定向量 | open |
| R10 | serialport 原生模块 Electron ABI | S2 构建失败 | 中 | electron-rebuild；或 napi 延后 | open |
| R11 | NS2 专有按键（C/GL/GR）在 EasyCon 兼容的 PadReport 无位 | C 键功能缺失 | 中 | MVP 显式忽略并记 lab-note；如需支持，先改 `packages/pad-types`/`02-PROTOCOL` 契约再实现 | open |

## 升级路径

- **P0 阻断**（R1）：停 S5 美化，只保留 S0b + S1/S2 最小路径。
- **S8 受阻**：转发链路用 S3 键盘/虚拟垫（manual）验证；NS2 Pro 专用解析单列，依据公开逆向文档（R3）推进。
- **S9 受阻**：时间轴预留 amiibo 轨，设备页显示「固件不支持」。

## 决策日志（短）

| 日期 | 决策 |
|------|------|
| 2026-08-21 | 新建协议兼容项目 + Electron + 时间轴；先 PC→NS2 |
| 2026-08-21 | 多 session 文档化落地于 `ns2-studio/docs` |
| 2026-08-22 | 输入源优先级定为：S3 键盘/虚拟垫 + S8 NS2 Pro；其他手柄（Xbox/XInput/SDL）暂不考虑 |
| 2026-08-22 | NS2 Pro 协议改用公开逆向资料 ndeadly/switch2_controller_research（报告 0x09、初始化 0x03/0x0D），取代「自抓包/XInput 兜底」路线 |

# S8 — NS2 Pro 采集与转发

| 字段 | 值 |
|------|-----|
| **Status** | `in_progress`（代码完成，真机待验） |
| **Priority** | P1（输入源中仅次于 S3 键盘/虚拟垫） |
| **Depends on** | S3 |
| **Blocks** | M4 |
| **Owns** | `apps/desktop/src/main/capture/**`, 手柄选择 UI |
| **Estimate** | 2–3 天 |

> 范围决策（2026-08-22）：输入源优先级 = **S3 键盘/虚拟垫（manual）+ 本 Session 的 NS2 Pro（forward）**。Xbox/XInput/SDL 等其他手柄 **暂不考虑**。
> 键盘输入不在本 Session：由 S3 §3.3 的 `manual` 源负责，本 Session 只产 `forward` 源。

## 1. 目标

有线 NS2 Pro 接入 PC，经 `node-hid` 解析为 `PadReport`，经 Hub `forward` 源实时下发；为 S7 提供高质量输入源。

## 2. 上下文注入

- 协议参考（公开逆向，无需自抓包起步）：
  - [ndeadly/switch2_controller_research](https://github.com/ndeadly/switch2_controller_research)：`hid_reports.md`（Pro Controller 2 输入报告 **0x09**：3 字节按键位域 + 12-bit 打包摇杆）、`commands.md`（USB 初始化：命令 `0x03` + 子命令 `0x0D` 启用输入报告，`0x0A` 选择报告 ID）、`descriptors.md`（VID/PID 与 USB 描述符）、`memory_layout.md`（摇杆校准）
  - 实现参考：[dalmatheo/procon2-driver](https://github.com/dalmatheo/procon2-driver)（Linux 驱动）、Nadeflore/switch2-controllers
- `03-DATA-MODELS.md` PadReport；RISKS R3、R11
- EasyCon `GamepadMapper.cs` 的映射思想（死区、swap ABXY 可配置）

## 3. 技术路线（唯一后端）

| 步骤 | 内容 |
|------|------|
| 1 | `node-hid` 枚举，按 `descriptors.md` 的 VID/PID 过滤 NS2 Pro（有线） |
| 2 | 发送初始化序列（`0x03`/`0x0D`，按需 `0x0A` 选定报告），进入稳定输入模式 |
| 3 | 解析输入报告 `0x09` → `PadReport`（12-bit 摇杆展开到 0–255，按键位域映射，D-Pad→HAT） |
| 4 | 轮询/事件 125–250Hz，`setSource(forward)` 下发；停止时 neutral |

解析失败或报告格式不符时回退「不支持」状态，**不得乱发**。

## 4. 任务清单

- [x] 设备枚举与过滤（VID/PID 以 `descriptors.md` 为准，实机复核并记入 lab-note）
- [x] 初始化握手序列封装 + 失败重试（output-report 传输失败→只监听模式，见 lab-note §12）
- [x] `0x09` 报告 parser（单测用固定向量，参考 `hid_reports.md` 表格）
- [x] 摇杆校准/死区配置项（MVP 无校准→原始线性映射并记日志；可选固定校准+死区）
- [x] `setSource(forward)` 接入；停止/掉线时 neutral（仅当 forward 为当前源时释放，避免劫持 manual/timeline）
- [x] NS2 专有按键处理：**C / GL / GR 在 PadReport 无位**，MVP 显式忽略并记入 lab-note（见 R11）
- [ ] lab-note：实机 VID/PID、报告长度、样例 hex、轮询率实测（真机待验）

## 5. 验收

- [ ] NS2 Pro 有线转发可在 NS2 菜单移动光标、可按键
- [ ] 延迟主观可接受（软件路径目标 < 30ms）
- [ ] 与 S7 联调：转发时可录制
- [ ] 拔掉 NS2 Pro 时无卡键（自动 neutral）

## 6. 不做

- Xbox/XInput/SDL 等其他手柄后端（暂不考虑，后续按需另开 Session）
- NS2 Pro 蓝牙模式（仅有线）
- 体感/陀螺仪完整支持（可预留字段）
- 震动回传（output 报告 `0x02` 仅记录，不实现）

## 7. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 范围收窄为仅 NS2 Pro；协议改用公开逆向资料（ndeadly 等），不再以 XInput 兜底 |
| 2026-08-22 | 协议调研完成，见 lab-notes/S8-ns2pro-protocol.md |
| 2026-08-22 | 代码完成（真机待验）。实现：`apps/desktop/src/main/capture/**`（`ns2-pro-parser.ts` 纯解析 + `node-hid-layer.ts` 懒加载降级 + `capture-service.ts` 编排），IPC 域 `capture:*`（channels-capture/ipc/preload/register/main index 追加接线），DevicePage 新增「NS2 Pro 采集」区块。**已完成项**：① 枚举过滤 VID/PID 0x057E:0x2069、排除安全模式 0x2072（`hid-factory.ts`）；② init 可插拔 transport，默认经 HID output report（report ID 0x02）发送 §7.1 最小集（0x0D+0x0A），失败记详细日志并进入「只监听默认报告」模式，不乱发数据；③ parser 严格按 §3/§4/§5/§8 字节表：按键位域→SwitchButton、D-Pad→HAT、12-bit 解包（procon2 公式）、C/GL/GR 忽略（R11）、无校准→原始值线性映射并记日志，可选固定校准+死区；④ 轮询/读循环 4ms 超时（≈250Hz，经 ReportWriter 节流），`hub.setSource("forward")` 启用、`hub.applyFrom("forward", report)` 下发，停止/拔线/解析失败均释放源并中立（仅当 forward 为当前源，不劫持 manual/timeline）；解析失败或长度不符→`unsupported` 态不发送。**真机待验项**（对照 §4 清单）：实机 VID/PID 与报告长度、样例 hex、12-bit 位序（未决#3）、实际轮询率（未决#5）、node-hid 缓冲是否含报告 ID 头（未决#6）、init 经 output report 是否有效（未决#1，最高优先）。**风险**：node-hid 为 native 模块，Electron ABI 依赖 prebuilt（已装 node-hid@3.4.0 并验证 Node 24 可加载）；主进程内懒加载，加载失败优雅降级为「采集不可用」不崩溃。验收：`pnpm -r test` 全绿（desktop 128 例含 parser 14 + capture 10），`pnpm --filter @ns2-studio/desktop build`/typecheck 通过。 |

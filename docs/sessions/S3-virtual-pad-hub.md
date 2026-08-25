# S3 — 虚拟手柄 + InputHub

| 字段 | 值 |
|------|-----|
| **Status** | `done`（真机操作待 S0 门禁；UI 目检待人工确认） |
| **Priority** | P0 |
| **Depends on** | S2（S0 用于真机验收） |
| **Blocks** | S6, S7, S8 |
| **Owns** | `apps/desktop/src/main/hub/**`, renderer 手柄页, 键位映射配置 |
| **Estimate** | 1–2 天 |

## 1. 目标

图形化虚拟 Pro/按键区 + 键盘映射；经 **InputHub** 以 `manual` 源输出到设备；保证复位与源切换安全。

## 2. 上下文注入

- `01-SYSTEM-ARCHITECTURE.md` §4 仲裁
- EasyCon `GamepadMapper` 思想（XY 交换等可配置）
- `03-DATA-MODELS.md` PadReport

## 3. 任务清单

### 3.1 InputHub（Main）

- [x] 状态：`activeSource: idle | manual | forward | timeline`
- [x] `setSource(src)`：先 `apply(NEUTRAL)` 再切换
- [x] `applyFrom(source, report)`：仅当 source===active 时下发
- [x] `forceNeutral()`
- [x] 向 DeviceService 写 report（合并 pending）
- [x] IPC：`hub:setSource`, `hub:getState`, 状态变更推送

### 3.2 虚拟手柄 UI

- [x] 按键：A/B/X/Y/L/R/ZL/ZR/+/−/Home/Capture/L3/R3
- [x] HAT 八向
- [x] 左右摇杆（指针拖拽）；松手回中（可切换保持）
- [x] pointerdown/up/leave 正确产生 report
- [x] 显示当前 report 调试条（可折叠）

### 3.3 键盘映射

- [x] 默认 WASD=左摇杆或 HAT（二选一，默认 HAT）；J/K/U/I 等 = ABXY
- [x] 映射可编辑（简单表单即可）
- [x] 仅当 source=manual 且窗口焦点时捕获（避免打字误触；可加「捕获中」切换）

### 3.4 设备页联动

- [x] 连接成功后允许进入手柄页
- [x] 进入手柄页自动 `setSource(manual)`；离开可选 idle+neutral

## 4. 验收

- [ ] NS2 菜单可用虚拟垫操作（S0 通过时）
- [x] 切换离开页面无卡键
- [x] 快速连点不拖垮 UI；Main 写串口仍节流

## 5. 不做

- 时间轴播放
- Pro HID
- 摇杆贝塞尔高级曲线（可后置）

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 实现 InputHub（`main/hub/input-hub.ts`）：activeSource 仲裁、setSource 先中立再切换、applyFrom 按源门控、forceNeutral、断开自动回 idle；写报告走 DeviceService 的 ReportWriter（合并 pending + 节流）。IPC 新增 `hub:setSource/getState/forceNeutral/stateChanged` + `pad:apply/reset`（channels-hub/pad、ipc.ts、preload、register、main index 全部接好，与 S5/S9 并行改动合并）。虚拟手柄页（PadPage.vue）实现全部按键 + HAT 八向 + 双摇杆拖拽（松手回中/保持可切换）+ 可折叠调试条；键盘映射默认 WASD=HAT、J/K/U/I=ABXY，简单表单可编辑（键捕获/动作/值），仅 source=manual 且窗口焦点 + 捕获开关时生效。设备页联动：未连接显示门禁提示；进入页面自动 setSource(manual)，离开回 idle+neutral。测试：input-hub 8 例、pad-state 11 例、pad-keymap 4 例，desktop 39 例全绿；build 通过。UI 交互（指针拖拽/视觉反馈）无法无头验证，已代码审查 + 构建通过，待人工目检（`NS2_STUDIO_MOCK_SERIAL=1 pnpm --filter @ns2-studio/desktop dev`）。真机菜单操作待 S0 门禁。注：typecheck 报 S5 的 register.ts（ProjectChannels/AmiiboChannels 对话框 null 处理）与 timeline/store.ts、TimelinePage.vue 的 TS 错误，属他 session 文件，未代修。 |

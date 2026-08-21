# S3 — 虚拟手柄 + InputHub

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S2） |
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

- [ ] 状态：`activeSource: idle | manual | forward | timeline`
- [ ] `setSource(src)`：先 `apply(NEUTRAL)` 再切换
- [ ] `applyFrom(source, report)`：仅当 source===active 时下发
- [ ] `forceNeutral()`
- [ ] 向 DeviceService 写 report（合并 pending）
- [ ] IPC：`hub:setSource`, `hub:getState`, 状态变更推送

### 3.2 虚拟手柄 UI

- [ ] 按键：A/B/X/Y/L/R/ZL/ZR/+/−/Home/Capture/L3/R3
- [ ] HAT 八向
- [ ] 左右摇杆（指针拖拽）；松手回中（可切换保持）
- [ ] pointerdown/up/leave 正确产生 report
- [ ] 显示当前 report 调试条（可折叠）

### 3.3 键盘映射

- [ ] 默认 WASD=左摇杆或 HAT（二选一，默认 HAT）；J/K/U/I 等 = ABXY
- [ ] 映射可编辑（简单表单即可）
- [ ] 仅当 source=manual 且窗口焦点时捕获（避免打字误触；可加「捕获中」切换）

### 3.4 设备页联动

- [ ] 连接成功后允许进入手柄页
- [ ] 进入手柄页自动 `setSource(manual)`；离开可选 idle+neutral

## 4. 验收

- [ ] NS2 菜单可用虚拟垫操作（S0 通过时）
- [ ] 切换离开页面无卡键
- [ ] 快速连点不拖垮 UI；Main 写串口仍节流

## 5. 不做

- 时间轴播放
- Pro HID
- 摇杆贝塞尔高级曲线（可后置）

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

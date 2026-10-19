# S14 — 手机控制页（触屏虚拟手柄）

| 字段 | 值 |
|------|-----|
| **Status** | `in_progress`（代码完成，真机手感/联调待验） |
| **Priority** | P1 |
| **Depends on** | S13 |
| **Blocks** | S15（视频区接入点） |
| **Owns** | `apps/remote-client/**` |
| **Estimate** | 2–3 天 |

> 契约：[08-REMOTE.md](../architecture/08-REMOTE.md) §4/§8。
> 形态决策（2026-10-19）：**vanilla TS + Vite**，不引入框架。

## 1. 目标

手机浏览器打开 Gateway 托管的静态页：token 门（QR 携带）、触屏虚拟手柄
全键位、仅变化上报 + 心跳、断开/切后台主动释放、会话状态显示。

## 2. 上下文注入

- `08-REMOTE.md` §4 消息协议（auth/source/pad/release/ping/state/error）
- `packages/pad-types`（`PadReport`/`SwitchButton`/`SwitchHat`/`NEUTRAL_REPORT` 数值域）
- `08-REMOTE.md` §7（`heartbeatMs` 从 `GET /api/config` 获取）

## 3. 任务清单

- [x] 包脚手架：`vite` + `vanilla-ts`，`build.outDir = ../../apps/desktop/out/remote-client`
- [x] `src/ws.ts`：连接/鉴权/指数退避重连/心跳（`ping` 间隔=heartbeatMs）/RTT
- [x] `src/state.ts`：输入状态聚合 → `PadReport`，变化检测（位差/摇杆差>0）
- [x] `src/ui/gamepad.ts`：ABXY、hat、L 虚拟摇杆（pointer capture）、
      L/R/ZL/ZR、±/HOME/Capture、L/R click；`touch-action:none`
- [x] 接管流程：「连接 → 授权 → 接管(remote 源)」三段式状态机 + 「断开」
- [x] 释放保护：`visibilitychange`/`pagehide`/`beforeunload` → `release`
- [x] `src/ui/status.ts`：连接/源/RTT/设备状态展示
- [x] 占位：视频区（S15）、「唤醒 NS」按钮（固件到位前显示不支持）
- [x] viewport/全屏/横屏适配（`viewport-fit=cover`、`100dvh`）

## 4. 验收

- [ ] 手机同 WiFi 扫码即达；授权后「接管」成功（桌面端源变 `remote`）
- [ ] 按键 → NS（mock 下为桌面日志）实时响应；主观延迟可接受
- [ ] 锁屏/切后台/断网 → 桌面端自动中立回 `idle`，重进页面可恢复会话
- [ ] 手机 Chrome/Safari 竖屏可玩、横屏布局不溢出

## 5. 不做

- 视频解码（S15 在预留区接入）
- 键盘/物理手柄输入（Gamepad API 后置）
- 摇杆灵敏度/死区自定义设置（用固定映射，后续按需）

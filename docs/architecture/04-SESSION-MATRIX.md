# 04 — Session 总表与并行矩阵

## 1. Session 一览

| ID | 名称 | 优先级 | 依赖 | 可并行泳道 | 预估 | 状态 |
|----|------|--------|------|------------|------|------|
| **S0** | 硬件通路冒烟 PC→S3→NS2 | P0 | 无 | 硬件 | 0.5–2d | in_progress |
| **S0b** | 固件 NS2 兼容（仅 S0 失败时） | P0 | S0 fail | 固件 | 不确定 | blocked-on-S0 |
| **S1** | `packages/protocol` + pad-types | P0 | 无* | 基础库 | 1d | done |
| **S2** | Electron 壳 + 设备连接 | P0 | S1 | 桌面 | 1–2d | done |
| **S3** | 虚拟手柄 + InputHub | P0 | S2 | 桌面 | 1–2d | done |
| **S4** | timeline-model + 编译器 | P0 | S1 | 基础库 | 1–2d | done |
| **S5** | 时间轴编辑器 UI | P0 | S4, S2 | 桌面-UI | 3–5d | done |
| **S6** | 时间轴回放引擎对接设备 | P0 | S3, S4, S5 | 桌面 | 1–2d | done |
| **S7** | 录制帧流 + 烘焙时间轴 | P1 | S3, S4 | 桌面 | 1–2d | done |
| **S8** | NS2 Pro 采集转发 | P1 | S3 | 输入 | 2–3d | in_progress |
| **S9** | Amiibo 库与协议下发 | P1 | S2, 固件能力 | 桌面 | 1–2d | done |
| **S10** | Amiibo 时间轴轨道 | P1 | S5, S6, S9 | 桌面 | 0.5–1d | done |
| **S11** | 打磨与发布（设置/打包/图标） | P2 | S6 | 桌面 | 1–2d | done |
| **S12** | 文档收口与端到端验收 | P2 | 主路径完成 | 架构 | 1d | blocked |
| **S13** | 远程桥（Gateway/remote 源/鉴权） | P1 | S3 | 桌面 | 1–2d | done |
| **S14** | 手机控制页（触屏手柄） | P1 | S13 | 桌面-Web | 2–3d | done |
| **S15** | 远程视频下行（WebRTC） | P1 | S13, S14 | 桌面 | 2–3d | in_progress |
| **S16** | 公网访问（Tailscale） | P2 | S13 | 文档 | 0.5d | done |
| **S17** | 手机端操控重构（横屏 Overlay） | P2 | S14 | 桌面-Web | 0.5–1d | in_progress |
| **S18** | UI 基建：Switch 风格双主题 + ui/ 组件库 + DevicePage 样板 | P1 | — | 桌面-Web | 1d | done |

\*S1 可与 S0 **并行**；但 **合并发布/真机演示** 必须 S0 通过。S1 单测不依赖硬件。

状态值：`ready` | `blocked` | `in_progress` | `done` | `blocked-on-S0` | `ready-after-S1`

## 2. 依赖图

```text
S0 ──────────────\ 
                  ──> 真机验收门禁 ──> S12
S0b (optional) ──/

S1 ──┬──> S2 ──> S3 ──┬──> S6 ──> S10 ──> S11 ──> S12
     │                ├──> S7
     │                └──> S8
     └──> S4 ──> S5 ──┘
          
S2 ──> S9 ─────────────> S10
```

## 3. 并行泳道（多 Session 同时开）

```text
时间 →

Lane HW:     [S0][S0b?]
Lane Proto:      [S1][S4............]
Lane App:            [S2][S3][S6][S7][S9][S10][S11]
Lane UI:                  [S5................]
Lane Input:                    [S8........]
Lane Arch:  文档维护贯穿；S12 收口
```

### 3.1 建议的「第一波」同时开工（2–3 人/会话）

| Session | 角色 |
|---------|------|
| S0 | 硬件/固件向 |
| S1 | 协议/单测向 |
| （S0+S1 完成后）S2 + S4 | 应用壳 + 模型 |

### 3.2 建议的「第二波」

| Session | 角色 |
|---------|------|
| S3 | 虚拟垫 + Hub |
| S5 | 时间轴 UI（可先 mock 编译结果） |
| S8 调研子任务 | HID 枚举探路（不接 Hub 也可） |

### 3.3 建议的「第三波」

S6 + S7 + S9 → S10 → S11 → S12

## 4. 目录所有权（防冲突）

| Session | 可写路径 |
|---------|----------|
| S0 | `tools/serial-smoke/**`, `docs/sessions/S0*`, `docs/lab-notes/**` |
| S0b | `firmware/**`, lab-notes |
| S1 | `packages/pad-types/**`, `packages/protocol/**` |
| S2 | `apps/desktop/**` 脚手架、main device、preload、基础 UI 壳 |
| S3 | `apps/desktop` 中 vpad、input-hub；不改 protocol 公共 API |
| S4 | `packages/timeline-model/**` |
| S5 | `apps/desktop/src/renderer` 时间轴相关；只读 model API |
| S6 | main timeline-engine；对接 hub |
| S7 | recorder、bake 调用、UI 入口 |
| S8 | main capture、映射；renderer 设备选择 |
| S9 | amiibo main+ui；protocol 仅当命令缺失时 PR 回 S1 |
| S10 | timeline amiibo track 粘合 |
| S11 | 设置、打包 electron-builder |
| S12 | `docs/**` 验收记录 |

**冲突规则：** 改 `packages/*/src` 公共导出必须在 PR/提交说明引用 architecture 文档修订。

## 5. 接口冻结点（Milestone）

| Milestone | 条件 | 冻结内容 |
|-----------|------|----------|
| M0 | S0 done | 接线与固件版本记录 |
| M1 | S1 done | PadReport + 打包 API |
| M2 | S2+S3 done | 可手动玩 NS2 |
| M3 | S4+S5+S6 done | 时间轴可回放控机 |
| M4 | S7+S8 done | 录制转发闭环 |
| M5 | S9+S10 done | Amiibo 闭环 |
| M6 | S11+S12 done | v1 可发布 |

## 6. 每日同步（多 session 时）

每个 session 结束或日终更新：

1. 本 Session md 顶部 Status / 进度 %  
2. MATRIX 表状态  
3. 若 API 变更 → architecture 文档  
4. 阻断项写入 [07-RISKS.md](./07-RISKS.md)

## 7. 工单文件索引

| ID | 文件 |
|----|------|
| S0 | [sessions/S0-hardware-smoke.md](../sessions/S0-hardware-smoke.md) |
| S0b | [sessions/S0b-firmware-ns2.md](../sessions/S0b-firmware-ns2.md) |
| S1 | [sessions/S1-protocol-package.md](../sessions/S1-protocol-package.md) |
| S2 | [sessions/S2-electron-shell.md](../sessions/S2-electron-shell.md) |
| S3 | [sessions/S3-virtual-pad-hub.md](../sessions/S3-virtual-pad-hub.md) |
| S4 | [sessions/S4-timeline-model.md](../sessions/S4-timeline-model.md) |
| S5 | [sessions/S5-timeline-editor-ui.md](../sessions/S5-timeline-editor-ui.md) |
| S6 | [sessions/S6-timeline-playback.md](../sessions/S6-timeline-playback.md) |
| S7 | [sessions/S7-record-and-bake.md](../sessions/S7-record-and-bake.md) |
| S8 | [sessions/S8-pro-capture-forward.md](../sessions/S8-pro-capture-forward.md) |
| S9 | [sessions/S9-amiibo.md](../sessions/S9-amiibo.md) |
| S10 | [sessions/S10-amiibo-timeline.md](../sessions/S10-amiibo-timeline.md) |
| S11 | [sessions/S11-polish-release.md](../sessions/S11-polish-release.md) |
| S12 | [sessions/S12-e2e-acceptance.md](../sessions/S12-e2e-acceptance.md) |
| S13 | [sessions/S13-remote-bridge.md](../sessions/S13-remote-bridge.md) |
| S14 | [sessions/S14-remote-client.md](../sessions/S14-remote-client.md) |
| S15 | [sessions/S15-remote-video.md](../sessions/S15-remote-video.md) |
| S16 | [sessions/S16-remote-public.md](../sessions/S16-remote-public.md) |
| S17 | [sessions/S17-remote-touch-ux.md](../sessions/S17-remote-touch-ux.md) |
| S18 | [sessions/S18-ui-foundation.md](../sessions/S18-ui-foundation.md) |

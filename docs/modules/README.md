# 模块文档目录

> 本文档集按「**先总再分**」组织：先读 `00-总览` 建立全局地图，再按需深入各模块。
> 覆盖除 **Amiibo**（`apps/desktop/src/main/amiibo/`）外的全部模块；Amiibo 见 `docs/architecture/` 与 `docs/sessions/S9/S10`。

| 文档 | 模块 | 关键代码位置 |
|------|------|--------------|
| [00-总览](00-总览.md) | 全局：架构、数据流、模块地图 | `apps/desktop/src/main/index.ts` |
| [01-pad-types](01-pad-types.md) | 手柄报告类型包 | `packages/pad-types/src/index.ts` |
| [02-protocol](02-protocol.md) | 串口协议包（7bit 打包、命令） | `packages/protocol/src/*` |
| [03-device](03-device.md) | 串口设备服务（生命周期、写队列） | `apps/desktop/src/main/device/*` |
| [04-input-hub](04-input-hub.md) | 输出源仲裁（InputHub） | `apps/desktop/src/main/hub/input-hub.ts` |
| [05-timeline-model](05-timeline-model.md) | 时间轴数据模型包（工程/录制/编译/烘焙） | `packages/timeline-model/src/*` |
| [06-timeline-engine](06-timeline-engine.md) | 主进程回放引擎 | `apps/desktop/src/main/timeline/engine.ts` |
| [07-recorder](07-recorder.md) | 帧录制器（S7） | `apps/desktop/src/main/recorder/recorder.ts` |
| [08-capture](08-capture.md) | NS2 Pro 采集转发（S8） | `apps/desktop/src/main/capture/*` |
| [09-config-log](09-config-log.md) | 配置持久化与日志 | `apps/desktop/src/main/config/*`、`log/*` |
| [10-ipc-renderer](10-ipc-renderer.md) | IPC 桥与渲染层（界面） | `src/preload/*`、`src/shared/*`、`src/renderer/*` |
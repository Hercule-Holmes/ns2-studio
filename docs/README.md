# NS2 Studio — 多 Session 协作文档中心

> 产品目标：Electron 桌面应用，经 ESP32-S3 控制 Nintendo Switch 2；支持虚拟手柄、NS2 Pro 录制/转发、时间轴宏排轴、Amiibo。
>
> 与 EasyCon 关系：**协议兼容的全新项目**（不包一层 .NET UI）。参考实现：`E:\nstool\EasyCon`。

## 文档地图

| 文档 | 用途 |
|------|------|
| [architecture/00-VISION.md](./architecture/00-VISION.md) | 产品愿景、范围、非目标 |
| [architecture/01-SYSTEM-ARCHITECTURE.md](./architecture/01-SYSTEM-ARCHITECTURE.md) | 系统架构、模块边界、数据流 |
| [architecture/02-PROTOCOL.md](./architecture/02-PROTOCOL.md) | PC↔MCU 协议（对齐 EasyCon） |
| [architecture/03-DATA-MODELS.md](./architecture/03-DATA-MODELS.md) | PadReport / 工程文件 / 录制格式 |
| [architecture/04-SESSION-MATRIX.md](./architecture/04-SESSION-MATRIX.md) | **Session 总表、依赖、并行策略** |
| [architecture/05-REPO-LAYOUT.md](./architecture/05-REPO-LAYOUT.md) | 仓库目录与包约定 |
| [architecture/06-DEFINITION-OF-DONE.md](./architecture/06-DEFINITION-OF-DONE.md) | 全局完成标准与验收 |
| [architecture/07-RISKS.md](./architecture/07-RISKS.md) | 风险、阻断项、升级路径 |
| [sessions/](./sessions/) | **各 Session 可独立领取的详细工单** |

## 如何开一个新 Session

1. 打开 [04-SESSION-MATRIX.md](./architecture/04-SESSION-MATRIX.md)，选一个状态为 `ready` 且依赖已满足的 Session。
2. 打开对应 `sessions/Sxx-*.md`，按「上下文注入」「任务清单」「交付物」「验收」执行。
3. 结束后更新该 Session 文档顶部的 **Status**，并在 MATRIX 中勾选。
4. 若发现接口变更，先改 `architecture/*` 契约文档，再改代码。

## 并行原则（架构师约束）

- **契约优先**：`packages/pad-types`、`packages/protocol`、工程 JSON schema 是跨 session 唯一真相源。
- **禁止越界**：Session 只改自己负责的目录；跨包改动必须先更新契约文档。
- **硬件阻断上浮**：NS2 不识别固件时，暂停 UI 花活，优先 S0/S0b。
- **一个活动输出源**：手动 / Pro 转发 / 时间轴播放互斥，避免抢写串口。

## 推荐启动顺序（第一条关键路径）

```text
S0 硬件冒烟  →  S1 协议包  →  S2 Electron壳+设备连接  →  S3 虚拟手柄
                     ↘ 可与 S1 后并行：S4 时间轴模型
```

详见 MATRIX 中的泳道图。

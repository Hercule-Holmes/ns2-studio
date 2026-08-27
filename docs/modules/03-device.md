# 03 — device：串口设备服务

> 位置：`apps/desktop/src/main/device/`
> 组成：`device-service.ts`（状态机）、`report-writer.ts`（写队列）、`serial-port-layer.ts` / `mock-serial-layer.ts` / `serial-factory.ts` / `types.ts`

## 1. 职责边界

| 做 | 不做 |
|----|------|
| 串口生命周期（连接/断开/重连） | 业务策略（输出源仲裁归 InputHub） |
| Hello/Version 握手 | 脚本烧写、Amiibo 分包（走 `writeCommand` 原语） |
| RX 报告解码与日志 | 解析 Pro 手柄（归 capture） |
| 合并写队列（报告只发最新） | — |

## 2. 连接状态机（`device-service.ts`）

```
disconnected ──connect()──▶ connecting ──打开串口──▶ handshaking
                                                        │
                ┌───────── Hello [0xA5,0x81] → 收到 0x80 回执（2s 超时）
                │         Version [0xA5,0x85] → 收集 ASCII（500ms / 80ms 静默判定）
                ▼
            connected ──disconnect()/异常──▶ disconnected / error
```

- 每步都 `emit("stateChanged")` → IPC 广播 → UI 状态灯
- 意外断开（非 `intentionalClose`）→ 回到 `disconnected` 并告警
- 握手/版本均通过 `onRxData` 原始字节监听（不经过报告解码）

**RX 双路分发**（`handleData`）：原始字节先喂给 `rxListeners`（握手用），`connected` 后再尝试按 8 字节帧解码（`tryDecodeReports`，逐字节滑动，失败 shift 重试）。

## 3. 写队列（`report-writer.ts`）

```
enqueueReport(PadReport)  → 与队列中最后一个 report 合并（"只发最新"）
enqueueCommand(bytes)     → 严格 FIFO，绝不合并（Amiibo 等需要 ACK 的流程）
flush()                   → 队列清空后 resolve（写者模型保证有序）
```

- **最小间隔** `minIntervalMs`（默认 2ms）：`writeBytes` 间 sleep 补齐
- **microtask 合并**：`schedulePump` 用 `queueMicrotask`，同步突发报告在出队前先合并
- 关闭时清队（`close()`），防止退出后残留写

## 4. 串口后端三层

| 层 | 文件 | 说明 |
|----|------|------|
| 接口 | `types.ts` | `SerialPortLike`（open/close/write/onData/onError/onClose/isOpen） |
| 真实现 | `serial-port-layer.ts` | 包装 `serialport@12`（N-API prebuild，无需 electron-rebuild）；`listSerialPorts()` |
| Mock | `mock-serial-layer.ts` | 内存串口：回 Hello(0x80)、Version("mock")、Amiibo ACK；连接后自动推一帧中立报告 |

**工厂**（`serial-factory.ts`）：`NS2_STUDIO_MOCK_SERIAL=1` 时用 mock（`MOCK-COM1`）；否则**懒加载**真实现（单测不碰原生模块）。

## 5. 公共 API（供 hub / Amiibo / 引擎使用）

```ts
connect(path, baud) → ConnectResult     // 完整握手
disconnect()                             // 先发中立再关
sendReport(report)                       // 入队 + flush
sendNeutral()                            // 中立报告
writeCommand(bytes)                      // 原始命令帧（Amiibo 等自管 ACK）
onStateChanged(cb) / onLog(cb) / onRxData(cb)
shutdown()                               // 退出钩子（best-effort）
```

## 6. 设计要点

1. **握手不猜**：Hello 只认 `Reply.Hello(0x80)`，版本收集 ASCII 且过滤不可打印字符。
2. **RX 报告解码只做日志**：当前固件不回传报告流，解码结果仅用于日志展示。
3. **写者模型**：pump 单飞（`running` 标志），杜绝并发写串口。
4. **可测性**：`layerFactory` 注入 + Mock，`test/device-service.test.ts` 覆盖全状态机。
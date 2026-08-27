# 02 — protocol：串口协议包

> 位置：`packages/protocol/src/`（`constants.ts`、`encodeReport.ts`、`commands.ts`、`index.ts`）
> 职责：PC ↔ ESP32（EasyCon 兼容）的字节级协议。纯函数，无 I/O。

## 1. 常量（`constants.ts`）

**命令字节**（对齐 EasyCon 固件）：

```ts
EzDvCommand = {
  Ready: 0xa5,  Debug: 0x80,  Hello: 0x81,  Flash: 0x82,
  ScriptStart: 0x83, ScriptStop: 0x84, Version: 0x85, LED: 0x86,
  UnPair: 0x87, ChangeControllerMode: 0x88, ChangeControllerColor: 0x89,
  SaveAmiibo: 0x90, ChangeAmiiboIndex: 0x91,
}
```

**应答字节**：`Error 0x00 / Busy 0xfe / Ack 0xff / Hello 0x80 / FlashStart 0x81 / FlashEnd 0x82 / ScriptAck 0x83`。

**Amiibo 分包大小**：`SAVE_AMIIBO_PACKET_SIZE = 20`。

## 2. 报告编码/解码（`encodeReport.ts`）——7bit 打包

**帧规则**：8 字节报告经"7 位打包"变成 **8 字节帧**，最后一字节最高位置 1 作为帧尾（`encodeReport`）：

```ts
// 打包：7 字节数据按位流连续拼接，每 7 位切一字节；末字节 |0x80
// 解包：反方向；校验"除末字节外任何字节 bit7=1 即非法帧"
```

| 方向 | 输入 | 输出 |
|------|------|------|
| `encodeReport(report)` | `PadReport`（buttons 高/低字节 + hat + 4 轴 = 7 字节） | 8 字节帧（末字节带 0x80） |
| `decodeReportPacket(packet)` | 8 字节帧 | `{ report, serialized }`；校验失败返回 `null` |

**固件侧等价物**：EasyMCU `easycon.c` 的 `set_buttons(...)` 移位拼接解包（见 `F:\nstool\docs\EasyMCU\02-核心模块-串口协议.md`）——两边是同一协议的正反实现。

## 3. 命令帧构造（`commands.ts`）

| 函数 | 帧 | 用途 |
|------|-----|------|
| `buildHelloFrame()` | `[0xA5, 0x81]` | 连接握手（Ready + Hello） |
| `buildChangeAmiiboIndexFrame(i)` | `[0xA5, i&0x0F, 0x91]` | 切换 Amiibo 槽位 |
| `buildSaveAmiiboMetaFrame(offset, len, index)` | `[0xA5, offset(14bit), len(14bit), index, 0x90]` | Amiibo 分块写头 |

`commands` 命名空间统一导出（`ready/hello/changeAmiiboIndex/saveAmiiboHeader`），并预置 `VERSION_FRAME = [0xA5, 0x85]` 供设备服务查询版本。

## 4. 设计要点

- **与硬件固件共享语义**：命令/应答常量即 EasyCon 协议；任何改动都需同步 EasyCon 固件与 `docs/architecture/02-PROTOCOL.md`。
- **纯函数 + 固定向量**：`test/` 用字节向量对拍 C# 侧实现（R9 风险缓解）。
- **只发最新**不在此层：编码是无状态函数，写队列的合并逻辑在 DeviceService 层（见 03）。
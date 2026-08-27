# 08 — capture：NS2 Pro 采集转发（S8）

> 位置：`apps/desktop/src/main/capture/`（`capture-service.ts`、`ns2-pro-parser.ts`、`node-hid-layer.ts`、`hid-factory.ts`、`types.ts`）
> 职责：读取**有线 NS2 Pro 手柄**（node-hid），解析为 `PadReport`，经 InputHub `forward` 源实时转发给 Switch。

## 1. 链路总览

```
node-hid（HIDAsync）→ 64 字节帧(0x09) → ns2-pro-parser → PadReport
      → hub.applyFrom("forward", report) → ReportWriter → 串口 → Switch
```

## 2. 设备识别（`ns2-pro-parser.ts` / `hid-factory.ts`）

| 常量 | 值 | 说明 |
|------|-----|------|
| VID/PID | `0x057E / 0x2069` | 有线 Pro Controller 2 |
| 安全模式 PID | `0x2072` | **排除**（仅单 vendor 接口，非采集路径） |
| 帧长 | USB 64 字节（`[0]=0x09` 报告 ID）；BT 63 字节（无 ID，备用） | 其他长度 → 不支持 |

`listNs2ProDevices()` 枚举 + 过滤（保留 path），`openNs2ProDevice()` 打开 `HIDAsync`。

## 3. 初始化（当前策略：output-report 尽力而为）

`buildInitCommands()` 生成最小初始化序列（lab-note §7.1）：

```
[0x03 0x91 00 0d 00 08 00 00 01 00 FF...FF]   // 0x03/0x0D 启用输入
[0x03 0x91 00 0a 00 04 00 00 09 00 00 00]     // 0x03/0x0A 选定报告 0x09
```

- 经 HID **output report（报告 ID 0x02）** 发送，间隔 15ms
- 发送失败 → 记日志降级为 `listen-only`（只监默认报告，不阻断启动）
- 所有命令/报告格式以 lab-note 与社区逆向（ndeadly/dalmatheo）为准，**未知字段绝不猜测**

## 4. 报告解析（`ns2-pro-parser.ts`）

**64 字节 USB 帧 → 剥报告 ID → body[1..63]**：

| body 偏移 | 内容 |
|-----------|------|
| 0x00 | 计数器 counter |
| 0x01 | 电源信息（battery = `(powerInfo>>2)&0x0F`，≤9 才有效） |
| 0x02..0x04 | 按键位域：byte0（B/A/Y/X/R/ZR/+/R摇杆按）、byte1 低 4 位 D-Pad +（L/ZL/-/L摇杆按）、byte2（HOME/截图；**C/GL/GR 忽略**，R11） |
| 0x05..0x07 | 左摇杆 12-bit 打包（`x = b0 \| (b1&0x0F)<<8`，`y = b1>>4 \| b2<<4`） |
| 0x08..0x0A | 右摇杆同上 |

**摇杆映射**：默认无校准 → `raw >> 4` 线性映射到 0..255；可选校准（死区 + 归一化）。**D-Pad → HAT**：对向同按视为中立（设计决策）。

**安全红线**：非 0x09 / 非 64/63 字节帧 → 解析返回 `null` → 进入 `unsupported` 状态并**不得发任何报告**（"不得乱发"）。

## 5. 服务状态机（`capture-service.ts`）

```
idle ──start()──▶ connecting ──▶ streaming（readLoop 循环）
                        │              │
                        └──失败──▶ error（可重试）
streaming ──stop()──▶ idle      （releaseForward → hub.setSource("idle") 自动中立）
streaming ──拔线──▶  onClose → idle（告警日志）
streaming ──unsupported 帧──▶ unsupported（停止）
```

- `readLoop`：`dev.read(4ms)` 超时轮询（对齐 250Hz 端点），解析后 `hub.applyFrom("forward", ...)`
- **优雅降级**：node-hid 加载失败缓存错误 → `list()` 返回空 + `loadError` 暴露给 UI，应用不崩
- `dispose()`：退出钩子（best-effort 关闭）

## 6. 分层与可测性

| 层 | 职责 | 注入点 |
|----|------|--------|
| `hid-factory` | 枚举/打开（真实 node-hid） | `listDevices`/`openDevice` |
| `node-hid-layer` | `HidDeviceLike` 封装（read 超时、close 确定性） | — |
| `ns2-pro-parser` | 纯函数解析（固定向量单测） | `parserOptions`（校准） |
| `capture-service` | 生命周期 + 状态 + hub 交互 | 全依赖注入 |

## 7. 已知限制（与文档一致）

- **init 通道未验证**（lab-note §10 #1）：输出报告路径可能不被固件接受，当前先发后用 `listen-only` 兜底
- 蓝牙模式不在范围（S8 决策仅有线）
- C/GL/GR 按键无 PadReport 位（R11），MVP 显式忽略
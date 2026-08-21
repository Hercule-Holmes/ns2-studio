# 02 — PC ↔ MCU 协议（EasyCon 兼容）

> 实现真相源：本文件 + `packages/protocol` 测试用例。  
> 行为参考：`EasyCon/src/EasyCon.Device/**`。

## 1. 物理层

| 项 | 默认 | 备注 |
|----|------|------|
| 接口 | USB-UART / CDC | 端口名 Windows: `COMx` |
| 波特率 | 115200 | EasyCon 失败时回退 9600 |
| 数据位 | 8N1 | |
| 流控 | 无 | |

## 2. 控制器状态 Report

### 2.1 逻辑字段（打包前）

| 字段 | 类型 | 说明 |
|------|------|------|
| Button | uint16 BE | 位标志，见下表 |
| HAT | uint8 | 0x00–0x07 方向，0x08 中立 |
| LX, LY | uint8 | 0–255，中心 128 |
| RX, RY | uint8 | 同上 |

### 2.2 Button 位（与 EasyCon `SwitchButton` 一致）

| 位值 | 键 |
|------|-----|
| 0x0001 | Y |
| 0x0002 | B |
| 0x0004 | A |
| 0x0008 | X |
| 0x0010 | L |
| 0x0020 | R |
| 0x0040 | ZL |
| 0x0080 | ZR |
| 0x0100 | MINUS |
| 0x0200 | PLUS |
| 0x0400 | LCLICK |
| 0x0800 | RCLICK |
| 0x1000 | HOME |
| 0x2000 | CAPTURE |

### 2.3 HAT

| 值 | 方向 |
|----|------|
| 0 | TOP |
| 1 | TOP_RIGHT |
| 2 | RIGHT |
| 3 | BOTTOM_RIGHT |
| 4 | BOTTOM |
| 5 | BOTTOM_LEFT |
| 6 | LEFT |
| 7 | TOP_LEFT |
| 8 | CENTER |

### 2.4 摇杆常量

- `STICK_MIN = 0`
- `STICK_CENTER = 128`
- `STICK_MAX = 255`

### 2.5 7-bit 串口打包（与 `SwitchReport.GetBytes` 一致）

1. 序列化 7 字节原始：`Button_hi, Button_lo, HAT, LX, LY, RX, RY`  
   （Button 为 big-endian：`BitConverter.GetBytes(Button).Reverse()` 在小端机器上即 hi,lo）
2. 将字节流按 **高位先出** 拆成 7bit 单元，每单元一字节，bit7=0 表示数据续。
3. **最后一个** 字节 bit7 置 1 作为结束标志。

伪代码：

```text
n=0; bits=0; packet=[]
for b in serialized:
  n = (n<<8)|b; bits += 8
  while bits >= 7:
    bits -= 7
    packet.push( (n>>bits) & 0x7F )
    n &= (1<<bits)-1
packet[last] |= 0x80
```

中立包：Button=0, HAT=8, 四摇杆=128。

## 3. 控制命令

前缀风格对齐 EasyCon：常先发 `Ready(0xA5)`，再带参数与命令字节。

| 命令 | 值 | 方向 | 说明 |
|------|-----|------|------|
| Ready | 0xA5 | PC→ | 同步/帧前缀 |
| Debug | 0x80 | | |
| Hello | 0x81 | PC→ | 握手；期望 Reply.Hello |
| Flash | 0x82 | | 烧录脚本（后置） |
| ScriptStart | 0x83 | | 后置 |
| ScriptStop | 0x84 | | 后置 |
| Version | 0x85 | | 查版本 |
| LED | 0x86 | | |
| UnPair | 0x87 | | |
| ChangeControllerMode | 0x88 | | |
| ChangeControllerColor | 0x89 | | |
| SaveAmiibo | 0x90 | | 见 §4 |
| ChangeAmiiboIndex | 0x91 | | 参数 index |

### 3.1 Reply

| 名 | 值 |
|----|-----|
| Error | 0x00 |
| Busy | 0xFE |
| Ack | 0xFF |
| Hello | 0x80 |
| FlashStart | 0x81 |
| FlashEnd | 0x82 |
| ScriptAck | 0x83 |

### 3.2 握手（Hello）

参考 `ResetControl`：最多 3 次写入 `[Ready, Hello]`，在超时窗口内收到 `Reply.Hello(0x80)` 视为成功。

### 3.3 ChangeAmiiboIndex

```text
TX: Ready, index, ChangeAmiiboIndex(0x91)
RX: Ack(0xFF) within ~200ms
```

`index` 建议 0–15（EasyCon 侧 `& 0x0F`）。

## 4. SaveAmiibo 分包

参考 `NintendoSwitchCmd.SaveAmiibo`：

- 分片大小：`PacketSize = 20`
- 对每个 offset `i`：
  1. 发头：`Ready, i&0x7F, i>>7, len&0x7F, len>>7, index, SaveAmiibo`  
     等待 `Ack`
  2. 发 body：`amiibo[i..i+len)` 原始字节  
     等待 `Ack`
  3. 失败则 `ResetControl`（Hello 握手）后重试同一片

完整 amiibo 二进制长度以实现/固件为准（常见 dump 540 字节量级，**以固件文档与实测为准**，协议层按 `byte[]` 透传）。

## 5. 联机 Report 发送策略（PC 侧）

| 策略 | 建议 |
|------|------|
| 是否逐帧 ACK | **否**（与 EasyCon 全量 report 路径一致，写后即忘） |
| 合并 | 队列只保留最新 pending report |
| 最小间隔 | 默认 2ms，可配置 1–8ms |
| 频率 | 目标 125–250Hz 有效更新 |
| 变化检测 | 可选：与上次完全相同则跳过（注意长按需定期 refresh，固件若要求） |

## 6. 版本与能力探测

连接成功后：

1. Hello  
2. Version（若固件支持）  
3. 记录 raw 版本字符串/字节  
4. UI 根据能力位启用 Amiibo（未知则「尝试可用 + 失败提示」）

## 7. 兼容性测试向量（S1 必做）

在 `packages/protocol` 固定测试：

1. 中立 report 打包字节序列（与 C# `GetBytes` 对拍）  
2. 仅 A 按下  
3. 左摇杆上（LX=128,LY=0）  
4. HAT LEFT  
5. 多键组合 A+B+L  

对拍方法：临时用 EasyCon 小工具打印 hex，或移植 C# 逻辑到测试注释中的期望 hex。

## 8. 非目标（协议 v1）

- 完整 Flash/Script VM 字节码（后置 Session）
- 蓝牙私有协议
- NS2 特有扩展轴（若有，另开 RFC 文档修订本文件）

# 01 — 核心模块深度：HID 手柄伪装（`hid/hid_device.c`）

> 前置阅读：`00-总览-完全解读.md` 第 3、5 节。
> 本文从 USB 协议最底层开始，把"板子为什么能被 Switch 认成手柄"讲到底。

---

## 1. 本模块的职责

| 输入 | 处理 | 输出 |
|------|------|------|
| 其他模块通过 `hid_device_set_report()` 写入的 8 字节手柄状态 | 维护状态 + 通过 TinyUSB 中断端点发送 | USB 中断 IN 端点 0x81 上的 8 字节 HID 输入报告 |

对外 API（`hid_device.h:45-51`）：

```c
void  hid_device_init(void);                              // 注册描述符、启动 TinyUSB
void  hid_device_set_report(const switch_hid_report_t *r);// 覆盖当前手柄状态
void  hid_device_get_report(switch_hid_report_t *r);      // 读取当前手柄状态
void  hid_device_send(void);                              // 尝试把状态发给主机
int   hid_device_is_ready(void);                          // 已挂载 && HID 可发送
int   hid_device_is_mounted(void);                        // 是否已被主机枚举挂载
```

---

## 2. USB 设备枚举：主机如何"认识"一个设备

USB 设备插入后，主机（Switch）会经历如下过程：

```
1. 设备上电 → 主机在总线上"看到"它
2. 主机发 SET_ADDRESS → 给设备分配地址
3. 主机读 设备描述符（Device Descriptor）     → "你是谁"
4. 主机读 配置描述符（Configuration Descriptor）→ "你能干什么"
5. 主机读 字符串描述符（String Descriptor）    → 人类可读名字
6. 主机读 HID 报告描述符（Report Descriptor）  → "你上报什么数据"
7. 枚举完成 → 设备进入运行态，开始接收/发送报告
```

对应代码就是 `hid_device.c` 里的三个 `static const` 数组 + 两个回调。

---

## 3. 设备描述符逐字节解析（`hid_device.c:60-75`）

```c
static const tusb_desc_device_t hid_device_descriptor = {
    .bLength            = sizeof(tusb_desc_device_t),  // 18 字节
    .bDescriptorType    = TUSB_DESC_DEVICE,            // 0x01
    .bcdUSB             = 0x0200,                      // USB 2.0
    .bDeviceClass       = 0x00,                        // 类定义在接口级（见下）
    .bDeviceSubClass    = 0x00,
    .bDeviceProtocol    = 0x00,
    .bMaxPacketSize0    = 64,                          // 端点 0 最大包长
    .idVendor           = 0x0F0D,                      // ★ HORI（任天堂授权厂商）
    .idProduct          = 0x0092,                      // ★ 某款 HORI 手柄
    .bcdDevice          = 0x0100,                      // 版本号 1.0
    .iManufacturer      = 0x01,                        // 指向字符串表第 1 项
    .iProduct           = 0x02,                        // 第 2 项
    .iSerialNumber      = 0x03,                        // 第 3 项
    .bNumConfigurations = 0x01,                        // 只有 1 个配置
};
```

**关键点 1：VID/PID 决定"身份"**。`0x0F0D` 是 HORI 公司。EasyCon 生态历史上的硬件基础就是 HORI Pokken Tournament Pro Pad（被刷了自定义固件），所以：

- Switch 侧：认出这是"已授权第三方手柄"，允许使用
- EasyCon 软件侧：靠这个 VID/PID 识别出"这是一个 EasyCon 设备"

**关键点 2：`bDeviceClass = 0x00`** 表示设备类由**每个接口**自己声明（见配置描述符），这是复合设备的标准做法——允许同一个设备里混搭 HID、CDC 等不同类。

**字符串表**（`hid_device.c:77-82`）：

```c
(char[]){0x09, 0x04},          // 第 0 项：语言代码 0x0409 = English（固定格式）
"Easycon",                     // iManufacturer = 1
"Easycon Pro Controller",      // iProduct = 2
"0123456789",                  // iSerialNumber = 3
```

---

## 4. 配置描述符逐字节解析（`hid_device.c:53-58`）

```c
#define TUSB_DESC_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)  // 9 + 9 = 18

static const uint8_t hid_configuration_descriptor[] = {
    TUD_CONFIG_DESCRIPTOR(
        1,                        // 配置编号
        1,                        // 接口数量 = 1（只有 HID，没有 CDC！）
        0,                        // 配置字符串索引 = 无
        TUSB_DESC_TOTAL_LEN,      // 整个配置描述符长度 18
        TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP,  // 属性：支持远程唤醒
        70                        // 最大电流 70 × 2mA = 140mA
    ),
    TUD_HID_DESCRIPTOR(
        0,      // 接口号 0
        0,      // 备用设置
        false,  // 不支持报告 ID（报告第一字节就是数据，不是 ID）
        sizeof(switch_pro_hid_report_descriptor),  // 报告描述符长度
        0x81,   // ★ 中断 IN 端点（0x81 = 端点1 方向IN）——报告从这里发给主机
        64,     // 端点最大包长 64 字节
        1       // 轮询间隔 1ms（决定上报频率上限 1000Hz）
    ),
};
```

**关键点：这个配置里只有 HID 接口，没有 CDC 接口**。虽然 `sdkconfig.defaults` 开了 `CONFIG_TINYUSB_CDC_ENABLED=y`，但这里的自定义描述符把默认描述符整体替换了（`hid_device_init` 里 `tusb_cfg.descriptor.full_speed_config = hid_configuration_descriptor`），所以实际枚举出来的**只有 HID**。

> 推论：`cdc_rx_task`（`main.c:33`）和 `uart_handler_send` 里的 CDC 分支（`uart_handler.c:27-30`）在**当前板子固件形态下是死代码**——它们是为"原生 USB 口作 CDC 接 PC"的板型预留的（如标准 DevKitC-1 单 USB 口场景）。

---

## 5. HID 报告描述符逐段解析（`hid_device.c:11-51`）——核心中的核心

HID 报告描述符用"item"（条目）描述**输入报告由哪些字段组成**。逐段翻译：

### 5.1 声明：这是一个"游戏手柄"集合

```
Usage Page = 0x01 (Generic Desktop)      ← 通用桌面类
Usage      = 0x05 (Game Pad)             ← 用途：游戏手柄
Collection = Application (0x01)          ← 开一个应用集合
```

### 5.2 第一段：16 个按钮（2 字节）

```
Usage Page = 0x09 (Button)
Usage Min  = 1, Usage Max = 16           ← 按钮编号 1~16
Logical Min = 0, Logical Max = 1         ← 每按钮取值 0/1（按下/松开）
Report Count = 16, Report Size = 1       ← 16 个 1-bit 字段 = 2 字节
Input (Data|Variable|Absolute)           ← 可变绝对量
```

对应结构体 `Button`（`uint16_t`）的 16 个 bit，映射为：

| bit | 含义 | 对应宏（`hid_device.h`） |
|-----|------|--------------------------|
| 0 | Y | `SWITCH_BUTTON_Y` `(1<<0)` |
| 1 | B | `SWITCH_BUTTON_B` `(1<<1)` |
| 2 | A | `SWITCH_BUTTON_A` `(1<<2)` |
| 3 | X | `SWITCH_BUTTON_X` `(1<<3)` |
| 4 | L | `SWITCH_BUTTON_L` `(1<<4)` |
| 5 | R | `SWITCH_BUTTON_R` `(1<<5)` |
| 6 | ZL | `SWITCH_BUTTON_ZL` `(1<<6)` |
| 7 | ZR | `SWITCH_BUTTON_ZR` `(1<<7)` |
| 8 | Minus(-) | `SWITCH_BUTTON_MINUS` `(1<<8)` |
| 9 | Plus(+) | `SWITCH_BUTTON_PLUS` `(1<<9)` |
| 10 | 左摇杆按下 | `SWITCH_BUTTON_LCLICK` `(1<<10)` |
| 11 | 右摇杆按下 | `SWITCH_BUTTON_RCLICK` `(1<<11)` |
| 12 | Home | `SWITCH_BUTTON_HOME` `(1<<12)` |
| 13 | 截图 | `SWITCH_BUTTON_CAPTURE` `(1<<13)` |
| 14-15 | 未用 | — |

> 与 Switch Pro 手柄真实按键布局一致。EasyCon 侧的 PadReport 同样沿用这组位定义（ns2-studio `03-DATA-MODELS.md` 需要对齐）。

### 5.3 第二段：方向键 D-Pad（半字节 + 半字节填充 = 1 字节）

```
Logical Max = 7, Physical Max = 315 (2字节) ← 物理范围 0~315°（8 方向均分）
Report Size = 4, Report Count = 1
Usage = 0x39 (Hat Switch)                  ← 帽子开关（方向键）
Input (Data|Variable|Absolute)
Report Size = 4, Report Count = 1
Input (Constant)                          ← 4 bit 常量填充，补满 1 字节
```

对应 `HAT` 字段，取值定义（`hid_device.h:21-29`）：

| 值 | 方向 | 值 | 方向 |
|----|------|----|------|
| 0 | 上 | 4 | 下 |
| 1 | 右上 | 5 | 左下 |
| 2 | 右 | 6 | 左 |
| 3 | 右下 | 7 | 左上 |
| 8 | 居中（松开） | | |

### 5.4 第三段：4 个摇杆轴（4 字节）

```
Logical Max = 255, Physical Max = 255
Report Size = 8, Report Count = 4
Usage = 0x30 (X)  0x31 (Y)  0x32 (Z)  0x35 (Rz)
Input (Data|Variable|Absolute)
```

对应 `LX, LY, RX, RY`（0~255，128 居中，`SWITCH_STICK_CENTER`）。

### 5.5 第四段：厂商字节（1 字节输入）

```
Usage Page = 0xFF00 (Vendor Defined, 2字节)
Usage = 0x20
Report Count = 1, Input (Data|Variable|Absolute)
```

对应 `VendorSpec`。

### 5.6 第五段：输出报告（8 字节输出，未实现）

```
Usage Page = 0xFF00 (Vendor Defined)
Usage = 0x2621            ← 震动物理量（HORI 风格）
Report Count = 8, Output (Data|Variable|Absolute)
```

对应 TinyUSB 的 `tud_hid_set_report_cb` 回调——目前是空实现（`hid_device.c:95-99`）。主机（Switch）发来的 8 字节输出报告（震动指令）被**直接丢弃**。EasyCon 生态暂不实现震动；ns2-studio S8 工单同样声明"震动仅记录不实现"。

### 5.7 报告长度核对

| 字段 | 位数 | 字节 |
|------|------|------|
| 按钮 16×1bit | 16 | 2 |
| HAT 4bit + 填充 4bit | 8 | 1 |
| 摇杆 4×8bit | 32 | 4 |
| 厂商 1×8bit | 8 | 1 |
| **合计** | | **8 字节** |

与 `switch_hid_report_t`（`__attribute__((packed))`，无对齐填充）完全一致 → `tud_hid_report(0, &hid_next_report, sizeof(hid_next_report))` 一次发送 8 字节。

---

## 6. 运行时流程

### 6.1 初始化（`hid_device_init`，`hid_device.c:112-127`）

```
1. 把报告重置为中立态（所有摇杆 128、HAT=8、无按键）
2. 组装 TinyUSB 配置：设备描述符 + 配置描述符 + 字符串表
3. tinyusb_driver_install() —— 注册到 USB 硬件
4. 等 100ms 让主机完成枚举
5. 若已挂载 → 立即发一帧中立报告（让主机拿到初始状态）
```

### 6.2 发送（`hid_device_send`，`hid_device.c:137-147`）

```c
if (!tud_mounted()) return;   // 主机还没枚举完成 → 不发
if (!tud_hid_ready()) return; // 端点还没空闲 → 跳过（下一轮再试）
tud_hid_report(0, &hid_next_report, sizeof(hid_next_report));
gpio_set_level(GPIO_NUM_10, 0);   // 成功 → LED 灭
// 失败 → LED 亮
```

- **驱动方式**：TinyUSB 是"事件驱动 + 轮询检查"模型，`tud_hid_ready()` 检查主机是否取走了上一包。因为 8 字节包很小、1ms 间隔足够，所以无需队列。
- **LED（GPIO10）**：成功拉低、失败拉高。注意代码里**没有显式 `gpio_config`**——它依赖板级初始化（或 bootloader）已把 GPIO10 配为输出。若移植到别的板子需补配置。

### 6.3 谁在调用 send

`hid_tx_task`（`main.c:44-53`）：

```c
if (EasyCon_need_send_report()) {   // echo_ms == 0 时才发（节流）
    hid_device_send();
    EasyCon_report_send_callback(); // 重置节流计时
}
```

节流逻辑见 `02-串口协议` 文档第 5 节：它的本意是**限制串口回显频率**（报告每发一帧就 echo 给 PC），但副作用是把 HID 上报也节流到约 500Hz 以内——对 Switch 的 125–250Hz 期望来说绰绰有余。

---

## 7. 关键认知总结

1. **"伪装手柄" = 伪造描述符**：设备描述符（HORI 的 VID/PID）+ 配置描述符（HID 接口 + 中断端点）+ 报告描述符（按钮/HAT/摇杆/厂商字段）。
2. **报告描述符与结构体必须一一对应**：`tud_hid_report` 发送的字节就是报告描述符声明的输入报告布局。改结构体字段顺序前必须先改描述符，否则主机解析错乱。
3. **无报告 ID**：报告第一字节直接是数据。TinyUSB 层面对应 `tud_hid_report(0, ...)` 的 `instance=0`。
4. **输出通道（震动）已预留未实现**：描述符声明了 8 字节 vendor 输出，回调是空实现。
5. **与串口模块的耦合**：本模块只维护状态，`easycon.c` 通过 `hid_device_set/get_report` 读写状态，`main.c` 的 `hid_tx_task` 定时发送——三者解耦。

---

## 8. 扩展阅读

- 乐鑫官方 TinyUSB 文档：`https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/usb_device.html`
- TinyUSB HID 类示例：`esp-idf/examples/peripherals/usb/device/tinyusb_hid`
- 本项目另一侧视角（被读取方）：`03-核心模块-ECS脚本虚拟机`、`02-核心模块-串口协议`
# 01 — pad-types：手柄报告类型包

> 位置：`packages/pad-types/src/index.ts`
> 职责：全项目唯一的"手柄状态"数据契约。零依赖，纯 TS。

## 1. 核心类型：`PadReport`

```ts
export interface PadReport {
  buttons: number;  // 按键位图（SwitchButton 位掩码）
  hat: number;      // 方向键（SwitchHat 枚举值）
  lx: number; ly: number;  // 左摇杆 X/Y
  rx: number; ry: number;  // 右摇杆 X/Y
}
```

- 摇杆取值范围 `0..255`，**128 = 居中**（`STICK_CENTER`）
- `TimedPadReport` = `PadReport` + `tUs`（微秒时间戳，帧流/录制用）

## 2. 常量

| 常量 | 内容 |
|------|------|
| `SwitchButton` | 14 个按键位掩码：Y/B/A/X/L/R/ZL/ZR/MINUS/PLUS/LCLICK/RCLICK/HOME/CAPTURE |
| `SwitchHat` | 8 方向（0..7）+ 居中（8） |
| `STICK_MIN/CENTER/MAX` | 0 / 128 / 255 |
| `NEUTRAL_REPORT` | 中立报告（全松开、居中）——所有"复位/防卡键"场景的基准 |

> 按键位定义与 EasyCon 固件（`hid_device.h`）完全一致——这是协议兼容的地基。

## 3. 工具函数

| 函数 | 用途 |
|------|------|
| `isNeutral(report)` | 判断是否中立 |
| `clampStick(value)` | 夹取到 0..255（非法值回 128） |
| `mergeButtons(...)` | 多按键位图合并 |
| `nameToButton(name)` / `buttonToName(buttons)` | 按键名 ↔ 位掩码（时间轴编辑器/录制烘焙用） |

## 4. 使用方

- `protocol`：编码/解码报告的输入输出
- `device`：串口发送、RX 解码后的形态
- `capture`：NS2 Pro 解析器的输出目标
- `recorder`：帧存储的最小单元
- `timeline-model / timeline-engine`：帧流元素
- `renderer`：虚拟手柄 UI 构造报告

## 5. 设计要点

- **位图而非对象**：按键用位掩码，比较/合并/序列化都便宜（`sameReport` 等热路径）。
- **无副作用纯类型**：包内无任何 I/O，天然可被主进程、渲染进程、测试三端共用。
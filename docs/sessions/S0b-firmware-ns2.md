# S0b — 固件 NS2 兼容（仅 S0 失败时激活）

| 字段 | 值 |
|------|-----|
| **Status** | `blocked-on-S0` |
| **Priority** | P0（条件触发） |
| **Depends on** | S0 确认 NS2 不识别或按键无效 |
| **Owns** | `firmware/**`, `docs/lab-notes/S0b-*.md` |
| **Estimate** | 不确定（1 天～数周） |

## 1. 目标

得到一份在 **NS2 有线 USB** 下可被识别、并可被 EasyCon 兼容串口协议驱动的 ESP32-S3 固件。

## 2. 上下文注入

- S0 lab-notes（失败现象）
- EasyMCU 上游仓库（需 clone 到 `firmware/EasyMCU` 或 submodule）
- EasyCon Device 协议文档 `docs/architecture/02-PROTOCOL.md`
- USB HID 基础：Report Descriptor、Device/Interface class

## 3. 任务清单

- [ ] Clone EasyMCU（或当前 EasyCon 配套固件源）并固定 commit
- [ ] 确认 S3 目标板的 USB device 栈（TinyUSB 等）
- [ ] 对比 NS1 成功描述符 vs NS2 枚举行为（设备管理器 / USB 抓包）
- [ ] 最小改动假设列表（逐项试）：
  - [ ] VID/PID/字符串描述符
  - [ ] HID report 长度与描述符
  - [ ] 初始化 report 频率
  - [ ] 供电/Only USB-C 线质量
- [ ] 保持 **PC 串口协议不变**（优先改 HID 侧）
- [ ] 产出可刷 bin + 版本号 + changelog
- [ ] 用 S0 smoke 工具回归

## 4. 交付物

- 固件源码 fork 链接或 `firmware/` 树
- 构建说明
- 与协议兼容性声明（哪些命令可用）

## 5. 验收

- S0 验收标准全部满足
- 在 RISKS 将 R1 标为 `mitigated` 并写方案摘要

## 6. 不做

- 重写 PC 应用
- 蓝牙控制器完整协议（除非有线路径不可能）

## 7. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

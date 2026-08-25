# S9 — Amiibo 库与设备下发

| 字段 | 值 |
|------|-----|
| **Status** | `done`（库 + 分包下发 + UI；真机验收待固件支持/S0） |
| **Priority** | P1 |
| **Depends on** | S2, protocol SaveAmiibo 帧（S1）, 固件能力 |
| **Blocks** | S10 |
| **Owns** | `apps/desktop/src/main/amiibo/**`, AmiiboPage, userData 库 |
| **Estimate** | 1–2 天 |

## 1. 目标

导入 amiibo dump、本地库管理、写入 MCU 槽位、手动切换当前槽位。

## 2. 上下文注入

- `02-PROTOCOL.md` §4 SaveAmiibo
- EasyCon `NintendoSwitchCmd.SaveAmiibo` / `ChangeAmiiboIndex`
- `03-DATA-MODELS.md` §5
- Script 文档：`AMIIBO` 为 ESP32 专属

## 3. 任务清单

### 3.1 库

- [x] 目录 `userData/amiibo/files/*` + `index.json`
- [x] 导入文件复制入库；重名策略
- [x] 列表/重命名/删除
- [x] 不尝试「破解」；只当 raw bytes 仓库

### 3.2 Device API

- [x] `saveToSlot(slot, bytes)`：按 20B 分包 + ACK + 失败 Hello 重试（对齐 EasyCon）
- [x] `changeIndex(slot)`
- [x] 进度事件（bytes sent / total）
- [x] 超时与取消

### 3.3 UI

- [x] 槽位网格 0–15
- [x] 拖拽/按钮写入
- [x] 当前槽位指示
- [x] 固件不支持时的明确错误文案

### 3.4 能力探测

- [x] 连接后尝试 Version；维护 `capabilities.amiibo: boolean | unknown`
- [x] unknown 时允许用户强制尝试

## 4. 验收

- [x] 在支持固件上：写入槽位返回成功，切换 index ACK（mock 串口走通 + 单测覆盖；真机待固件）
- [x] 大文件分包中拔线：有错误状态，可重试（ACK 超时 → Hello 重握手重试同一分片，测试覆盖）
- [x] 仓库无用户 bin 被 git 跟踪（gitignore 已有 `*.bin` / `userData/`）

## 5. 不做

- 从空白生成合法加密 amiibo
- 美化 3D 模型展示

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | 完成库 + 设备下发 + UI + 能力探测。`apps/desktop/src/main/amiibo/**`：AmiiboStore（userData/amiibo：`index.json` {magic:AMIIBO,version:1,items[]} + `files/<uuid>.bin`，重名 ` (n)` 策略，导入/重命名/删除/readBytes/setLastSlot）；AmiiboDeviceApi（`saveToSlot` 按 `SAVE_AMIIBO_PACKET_SIZE`=20B 分包：头帧 `[A5,offLo,offHi,lenLo,lenHi,index,0x90]` 等 Ack → 发 body 等 Ack，Ack 超时/忙走 Hello 重握手后重试同片，最多 maxRetries 次；`changeIndex` `[A5,index,0x91]` 等 Ack/200ms；进度 onProgress(sent,total)；AbortSignal 取消）；AmiiboService（capabilities.amiibo 状态机：连接→unknown、保存/切换成功→true、收到 Error→false）。DeviceService 追加式暴露 `writeCommand`/`onRxData`/`isConnected`（只增不改）；MockSerialLayer 补 SaveAmiibo/ChangeAmiiboIndex ACK 应答（注明）。IPC 新增 `amiibo:*` 域（channels-amiibo.ts、ipc.ts 类型、preload、register、main wiring）。AmiiboPage.vue：库列表（导入/重命名/删除/拖拽）、槽位网格 0–15（点击选中项写入/空槽切换）、当前槽位高亮、进度条+取消、能力横幅与明确错误文案。验收：`pnpm -r test` 全绿（新增 amiibo-store 8 例 + device-api 8 例，含重试/取消/UNSUPPORTED/未连接/空数据）；desktop `build` 通过。真机写入待固件能力（S0）。 |

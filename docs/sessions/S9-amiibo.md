# S9 — Amiibo 库与设备下发

| 字段 | 值 |
|------|-----|
| **Status** | `blocked`（等 S2；需固件支持） |
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

- [ ] 目录 `userData/amiibo/files/*` + `index.json`
- [ ] 导入文件复制入库；重名策略
- [ ] 列表/重命名/删除
- [ ] 不尝试「破解」；只当 raw bytes 仓库

### 3.2 Device API

- [ ] `saveToSlot(slot, bytes)`：按 20B 分包 + ACK + 失败 Hello 重试（对齐 EasyCon）
- [ ] `changeIndex(slot)`
- [ ] 进度事件（bytes sent / total）
- [ ] 超时与取消

### 3.3 UI

- [ ] 槽位网格 0–15
- [ ] 拖拽/按钮写入
- [ ] 当前槽位指示
- [ ] 固件不支持时的明确错误文案

### 3.4 能力探测

- [ ] 连接后尝试 Version；维护 `capabilities.amiibo: boolean | unknown`
- [ ] unknown 时允许用户强制尝试

## 4. 验收

- [ ] 在支持固件上：写入槽位返回成功，切换 index ACK
- [ ] 大文件分包中拔线：有错误状态，可重试
- [ ] 仓库无用户 bin 被 git 跟踪（gitignore）

## 5. 不做

- 从空白生成合法加密 amiibo
- 美化 3D 模型展示

## 6. 进度日志

| 日期 | 笔记 |
|------|------|
| | |

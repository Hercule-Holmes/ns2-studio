# S1 — pad-types + protocol 基础库

| 字段 | 值 |
|------|-----|
| **Status** | `done` |
| **Priority** | P0 |
| **Depends on** | 无（可与 S0 并行） |
| **Blocks** | S2, S4 |
| **Owns** | `packages/pad-types/**`, `packages/protocol/**`, 根 workspace 最小脚手架 |
| **Estimate** | 1 天 |

## 1. 目标

提供 **无硬件依赖** 的 TypeScript 包：类型 + Report 7bit 编码 + 命令帧构造 + 单测对拍。

## 2. 上下文注入

- `docs/architecture/02-PROTOCOL.md`（实现规范）
- `docs/architecture/03-DATA-MODELS.md` §1–2
- `docs/architecture/05-REPO-LAYOUT.md`
- EasyCon：
  - `SwitchReport.cs` / `SwitchCommand.cs` / `CommandCode.cs`

## 3. 任务清单

### 3.1 Monorepo 最小根（若尚不存在）

- [x] `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` + `.gitignore`
- [x] 根脚本：`pnpm -r test`, `pnpm -r build`

### 3.2 `@ns2-studio/pad-types`

- [x] `SwitchButton` 枚举/常量（位值与文档一致）
- [x] `SwitchHat` 常量
- [x] `PadReport`, `TimedPadReport`, `NEUTRAL_REPORT`
- [x] 工具：`isNeutral`, `clampStick`, `mergeButtons`
- [x] 导出清晰的 `src/index.ts`

### 3.3 `@ns2-studio/protocol`

- [x] `encodeReport(report: PadReport): Uint8Array`（7bit 打包）
- [x] `decodeReportPacket`（可选，便于调试；非必须完美）
- [x] `commands.hello()`, `commands.ready()`, `commands.changeAmiiboIndex(i)`
- [x] `commands.saveAmiiboHeader(offset, len, index)` 字节布局
- [x] `Reply` 常量
- [x] 依赖 `pad-types`，不依赖 electron/serialport

### 3.4 测试（vitest）

- [x] 中立包 hex 快照
- [x] 仅 A、仅 B、A+B
- [x] HAT LEFT
- [x] 摇杆 LY=0 / LY=255 / LX=0
- [x] 打包最后一字节 bit7=1
- [x] 与文档伪代码边界一致（非 7 整除等）

**对拍：** 若 S0 lab-note 有 C# hex，建成 `test/vectors.json`。

### 3.5 文档

- [x] 各 package 简短 README（安装与示例 5 行）
- [x] 若发现协议歧义，PR 式修改 `02-PROTOCOL.md`（未发现歧义）

## 4. 公共 API 冻结（S1 done 后）

```ts
// pad-types
export interface PadReport { buttons: number; hat: number; lx: number; ly: number; rx: number; ry: number }
export const NEUTRAL_REPORT: PadReport
export const SwitchButton: { A: number; B: number; /* ... */ }
export const SwitchHat: { CENTER: 8; /* ... */ }

// protocol
export function encodeReport(report: PadReport): Uint8Array
export const Reply: { Ack: number; Hello: number; /* ... */ }
export const EzDvCommand: { Ready: number; Hello: number; SaveAmiibo: number; ChangeAmiiboIndex: number; /* ... */ }
export function buildHelloFrame(): Uint8Array
export function buildChangeAmiiboIndexFrame(index: number): Uint8Array
export function buildSaveAmiiboMetaFrame(offset: number, len: number, index: number): Uint8Array
```

下游 **只许依赖上述导出**；内部文件结构可改。

## 5. 交付物

- 可 `pnpm --filter @ns2-studio/protocol test` 全绿
- workspace 可安装

## 6. 验收

- [ ] 测试全过  
- [ ] 无 Node 专有 API 进入 pad-types（保持可在全环境用）  
- [ ] encode 输出可用手工串口工具发送（与 S0 交叉验证更佳）

## 7. 不做

- 串口打开
- Electron
- 时间轴 schema

## 8. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-08-22 | pad-types + protocol 实现完成。encodeReport 与 7 个固定向量（中立/A/A+B+L/HAT-LEFT/LY=0/LY=255/LX=0）精确对拍；另补 B、A+B 两个向量。vitest：pad-types 9 过，protocol 16 过；`pnpm -r build` 类型检查通过。根 pnpm-workspace.yaml 增加 `allowBuilds`（esbuild、@serialport/bindings-cpp，pnpm11 新键）。未修改 02-PROTOCOL.md（无歧义）。 |

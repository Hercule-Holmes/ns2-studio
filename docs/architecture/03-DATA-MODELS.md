# 03 — 数据模型

## 1. PadReport（运行时唯一输入语义）

```ts
/** 归一化手柄状态；所有输入源必须产出此结构 */
export interface PadReport {
  buttons: number; // uint16 bitflags，见协议文档
  hat: number;     // 0-8
  lx: number;      // 0-255
  ly: number;
  rx: number;
  ry: number;
}

export interface TimedPadReport extends PadReport {
  /** 单调时间，单位微秒（录制起点=0） */
  tUs: number;
}
```

中立常量：

```ts
export const NEUTRAL_REPORT: PadReport = {
  buttons: 0,
  hat: 8,
  lx: 128, ly: 128, rx: 128, ry: 128,
};
```

## 2. 按键枚举（TS 侧）

与协议位值一致，导出 `SwitchButton`、`SwitchHat`、`nameToButton()`、`buttonToName()`。

## 3. 录制文件（帧流，高保真）

### 3.1 容器：`*.nsrec.json`（MVP 可用 JSON；可后换二进制）

```json
{
  "magic": "NSREC",
  "version": 1,
  "meta": {
    "createdAt": "2026-08-21T00:00:00.000Z",
    "source": "forward|manual|timeline",
    "deviceName": "NS2 Pro",
    "tickHz": 250
  },
  "frames": [
    { "tUs": 0, "buttons": 0, "hat": 8, "lx": 128, "ly": 128, "rx": 128, "ry": 128 },
    { "tUs": 4000, "buttons": 4, "hat": 8, "lx": 128, "ly": 128, "rx": 128, "ry": 128 }
  ]
}
```

### 3.2 规则

- `tUs` 严格非递减
- 可不写重复帧（压缩）；回放时保持上一帧直到下一时间戳
- 可选后置：`.nsrec.bin` = header + `uint64 tUs + 7 byte raw report` 定长

## 4. 时间轴工程（`*.nsproj.json`）

```json
{
  "magic": "NSPROJ",
  "version": 1,
  "name": "示例连招",
  "durationMs": 12000,
  "gridMs": 10,
  "tracks": [
    {
      "id": "track_btn",
      "type": "buttons",
      "clips": [
        { "id": "c1", "key": "A", "startMs": 100, "endMs": 180 }
      ]
    },
    {
      "id": "track_ls",
      "type": "stick",
      "stick": "L",
      "clips": [
        {
          "id": "c2",
          "startMs": 0,
          "endMs": 500,
          "keyframes": [
            { "offsetMs": 0, "x": 128, "y": 128 },
            { "offsetMs": 500, "x": 128, "y": 0 }
          ]
        }
      ]
    },
    {
      "id": "track_hat",
      "type": "hat",
      "clips": [
        { "id": "c3", "startMs": 200, "endMs": 300, "hat": 2 }
      ]
    },
    {
      "id": "track_amiibo",
      "type": "amiibo",
      "clips": [
        { "id": "c4", "startMs": 800, "endMs": 801, "slot": 0 }
      ]
    },
    {
      "id": "track_marker",
      "type": "marker",
      "clips": [
        { "id": "m1", "startMs": 0, "endMs": 0, "label": "起手" }
      ]
    }
  ]
}
```

### 4.1 Track types

| type | clip 关键字段 | 编译语义 |
|------|----------------|----------|
| `buttons` | `key`, start/end | [start,end) 期间 buttons\|=bit |
| `stick` | `stick: L\|R`, keyframes | 线性插值 x,y |
| `hat` | `hat` | 区间内 hat=值；冲突时后写覆盖（需校验警告） |
| `amiibo` | `slot` | 在 startMs 触发 ChangeAmiiboIndex（边沿） |
| `marker` | `label` | 不生成输入 |

### 4.2 编译

```ts
function compile(project: Project, opts: { hz: number }): TimedPadReport[]
```

- 以 `1000/hz` ms 步进采样（或事件边界 + 采样混合）
- 同帧多 button clips 按位或
- stick 无 clip 时保持 128,128
- 输出可直接给 TimelineEng 或导出 nsrec

### 4.3 从录制烘焙到工程

```ts
function bake(rec: Recording, opts: BakeOptions): Project
```

- buttons：边沿检测生成 clips
- stick：降采样 + 关键点简化（RDP 算法可选）
- 死区：|v-128|<d 视为中立

## 5. Amiibo 库条目

```ts
interface AmiiboItem {
  id: string;          // uuid
  name: string;
  fileName: string;
  /** 相对 userData/amiibo/ */
  relPath: string;
  size: number;
  /** 可选：从 bin 解析的角色名 */
  character?: string;
  lastSlot?: number;
}
```

库索引：`userData/amiibo/index.json`。

## 6. 应用配置

```ts
interface AppConfig {
  serial: { path?: string; baud: number; minIntervalMs: number };
  capture: { deviceId?: string; tickHz: number; triggerThreshold: number; swapABXY: boolean };
  timeline: { defaultHz: number; gridMs: number };
  ui: { theme: "dark" | "light" };
}
```

路径：`userData/config.json`。

## 7. Schema 版本策略

- 所有文件带 `magic` + `version`
- `packages/timeline-model` 提供 `migrate(input) -> latest`
- 破坏性变更：version+1 并写迁移；Session 改 schema 必须更新本文档

## 8. 校验

- JSON Schema 或 Zod 放在对应 package
- 打开工程失败要可读错误（轨道 id 冲突、时间倒挂、非法 key）

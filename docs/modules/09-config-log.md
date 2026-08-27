# 09 — config & log：配置持久化与日志

> 位置：`apps/desktop/src/main/config/`（`store.ts`、`config-store.ts`）、`apps/desktop/src/main/log/file-logger.ts`
> 职责：应用设置/配置的 JSON 落盘，以及主进程日志与崩溃记录。

## 1. 两个存储（为什么分开）

| 存储 | 文件 | 类型 | 用途 |
|------|------|------|------|
| `SettingsStore` | `userData/settings.json` | `AppSettings` | 轻量**记忆型**设置（上次端口、波特率等） |
| `ConfigStore` | `userData/config.json` | `AppConfig` | **完整配置**（S11：串口/采集/时间轴/UI） |

两者均为**手写 JSON 持久化**（刻意不用 electron-store 依赖），写失败 best-effort 不崩溃。

## 2. `SettingsStore`（`store.ts`，43 行）

- `get()` / `update(patch)`：浅合并 + 落盘
- 语义：**记住上次选择**，启动时回填 UI

## 3. `ConfigStore`（`config-store.ts`，72 行）

**默认值**（`DEFAULT_APP_CONFIG`）：

```ts
serial:   { baud: 115200, minIntervalMs: 2 }
capture:  { tickHz: 250, triggerThreshold: 128, swapABXY: false }
timeline: { defaultHz: 250, gridMs: 10 }
ui:       { theme: "dark" }
```

- `get()`：`structuredClone` 返回（防外部篡改内部态）
- `update(patch)`：**深度合并**（`deepMerge`，数组整体替换）→ 落盘 → 返回新配置
- `load()`：读文件失败 → 返回默认值；解析结果与默认值深合并（**向前兼容新增字段**）

## 4. `FileLogger`（`file-logger.ts`）

| 文件 | 内容 |
|------|------|
| `userData/logs/main.log` | 常规日志（`log(scope, message)`，ISO 时间戳） |
| `userData/logs/crash.log` | 崩溃块（`crash(kind, detail)`，含堆栈） |

接入点（`main/index.ts`）：

```ts
process.on("uncaughtException",  → logger.crash("uncaughtException", ...))
process.on("unhandledRejection", → logger.crash(...))
process.on("warning",            → logger.log("warning", ...))
```

渲染进程错误经 `log:reportError` IPC 转发到 `crash.log`（S11 全局错误边界，见 10）。

## 5. 与 IPC 的对接

| 通道 | 行为 |
|------|------|
| `settings:get/update` | SettingsStore 直通 |
| `config:get/update` | ConfigStore 直通（`DeepPartialAppConfig` 深度补丁） |
| `log:subscribe` | 返回最近 500 条日志缓冲 |
| `log:reportError` | 渲染层错误 → crash.log |
| `appInfo:get` | 应用名/版本（`app.getName/getVersion`） |

## 6. 设计要点

1. **无第三方存储依赖**：手写 ~10 行 JSON 读写，可控且零传递依赖。
2. **默认值即契约**：`DEFAULT_APP_CONFIG` 与 `03-DATA-MODELS.md §6` 对齐，新增配置项必须同步两处。
3. **日志双轨**：实时流（IPC → UI 日志面板，500 条环形缓冲）与落盘（main.log/crash.log）分离。
4. **崩溃兜底全覆盖**：主进程 3 类事件 + 渲染层错误边界都汇入 crash.log。
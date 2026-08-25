# @ns2-studio/timeline-model

纯数据层：时间轴工程（`*.nsproj.json`）的 schema、校验、编译与烘焙。**无 UI、无串口、不依赖 electron/fs**，`compile`/`bake` 均为纯函数。

## API

```ts
validateProject(p: unknown): Project                    // 抛 ProjectValidationError（带稳定 code）
compile(p: Project, opts: { hz: number }): CompileResult
bake(rec: Recording, opts?: BakeOptions): Project
createEmptyProject(name: string): Project
migrate(input: unknown): Project                        // v1 identity 占位
hatConflictWarnings(p: Project): string[]               // hat 重叠警告（非错误）
```

- `CompileResult = { frames: TimedPadReport[]; amiiboEvents: { tUs; slot }[] }`
- `compile` 以 `1000/hz` ms 步进采样：buttons 按位或、stick 线性插值、hat 后写覆盖、amiibo 为旁路事件（不进 PadReport）。
- `bake` MVP：按键边沿 → button clips；摇杆可选降采样（`stickDecimation`）+ 死区（`deadZone`）。

## 运行

```sh
pnpm --filter @ns2-studio/timeline-model test
pnpm --filter @ns2-studio/timeline-model build
```

类型定义见 `docs/architecture/03-DATA-MODELS.md` §4（magic `NSPROJ`，version 1）。
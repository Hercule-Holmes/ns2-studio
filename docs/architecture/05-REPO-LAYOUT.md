# 05 — 仓库目录约定

根目录：`E:\nstool\ns2-studio\`

```text
ns2-studio/
├── README.md                 # 人读入口（S2/S11 可补全）
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── docs/                     # 本架构与 session 文档（已建）
│   ├── README.md
│   ├── architecture/
│   ├── sessions/
│   └── lab-notes/            # S0 实机日志（gitignore 大文件）
├── packages/
│   ├── pad-types/            # S1
│   │   ├── package.json
│   │   ├── src/index.ts
│   │   └── test/
│   ├── protocol/             # S1
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── encodeReport.ts
│   │   │   ├── commands.ts
│   │   │   └── index.ts
│   │   └── test/
│   └── timeline-model/       # S4
│       ├── package.json
│       ├── src/
│       │   ├── schema.ts
│       │   ├── validate.ts
│       │   ├── compile.ts
│       │   ├── bake.ts
│       │   └── index.ts
│       └── test/
├── apps/
│   └── desktop/              # S2+
│       ├── package.json
│       ├── electron.vite.config.ts
│       ├── src/
│       │   ├── main/
│       │   │   ├── index.ts
│       │   │   ├── device/DeviceService.ts
│       │   │   ├── hub/InputHub.ts
│       │   │   ├── timeline/TimelineEngine.ts
│       │   │   ├── capture/ProCapture.ts
│       │   │   ├── amiibo/AmiiboService.ts
│       │   │   └── ipc/register.ts
│       │   ├── preload/
│       │   │   └── index.ts
│       │   ├── renderer/
│       │   │   ├── main.ts
│       │   │   ├── App.vue
│       │   │   ├── pages/
│       │   │   │   ├── DevicePage.vue
│       │   │   │   ├── PadPage.vue
│       │   │   │   ├── TimelinePage.vue
│       │   │   │   └── AmiiboPage.vue
│       │   │   └── components/timeline/
│       │   └── shared/
│       │       ├── ipc.ts
│       │       └── channels.ts
│       └── resources/
├── tools/
│   └── serial-smoke/         # S0 CLI
│       ├── package.json
│       └── src/index.ts
└── firmware/                 # S0b：submodule 或 README 指向 EasyMCU fork
    └── README.md
```

## 包命名

- `@ns2-studio/pad-types`
- `@ns2-studio/protocol`
- `@ns2-studio/timeline-model`
- `@ns2-studio/desktop`
- `@ns2-studio/serial-smoke`

## 工具链默认

| 项 | 选择 |
|----|------|
| Node | ≥ 20 |
| 包管理 | pnpm |
| 测试 | vitest |
| 打包 | electron-builder（S11） |
| 格式 | prettier + eslint |

## Git 建议

- 主分支：`main`
- Session 分支：`session/s1-protocol` 等
- 禁止提交：固件超大 bin 可 LFS 或仅文档链接；amiibo 用户 bin 不进库

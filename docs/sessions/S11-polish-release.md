# S11 — 打磨与发布

| 字段 | 值 |
|------|-----|
| **Status** | `done`（NSIS + Portable 出包；遗留：干净机器跑安装包验收） |
| **Priority** | P2 |
| **Depends on** | S6； ideally S7–S10 大部完成 |
| **Owns** | 设置页、关于、electron-builder、用户 README、图标 |
| **Estimate** | 1–2 天 |

## 1. 目标

可分发给自己（及未来用户）的 Windows 构建；配置项收敛；崩溃与日志可定位。

## 2. 任务清单

- [x] 设置页：串口间隔、波特率、转发 hz、扳机阈值、swap ABXY、网格 ms
      （SettingsPage 已含全部字段 + 关于块）
- [x] 全局错误边界与 main crash 日志文件（renderer errorHandler + window
      error/unhandledrejection → FileLogger；main uncaughtException/unhandledRejection
      → userData/logs）
- [ ] 自动上次工程恢复（可选，跳过，后续按需）
- [x] `electron-builder` nsis + portable（两者都出，`pnpm --filter @ns2-studio/desktop dist`）
- [x] 应用图标与名称 **NS2 Studio**（`tools/gen-icon.mjs` 生成 resources/icon.ico；
      productName/appId 配置于 package.json build 段）
- [x] 根 `README.md`：接线、刷固件链接、开发启动、使用概览、第三方声明
- [x] 许可证与第三方 notice（`LICENSE` MIT；EasyCon 协议兼容声明与 GPL 边界
      说明见 README「许可证与第三方声明」）
- [x] 版本号 semver 与 about（0.1.0；SettingsPage「关于」显示 name/version）

打包要点（排障实录）：
- `npmRebuild: false`——node-hid/serialport 均为 N-API prebuild，无需 node-gyp
  （机器无 VS 构建工具时必须关掉，否则 electron-rebuild 失败）
- `files: ["out/**"]` + `asarUnpack: ["**/*.node"]`；remote-client 静态页随
  out/ 打进 asar（dist 脚本已显式先构建 remote-client）
- 下载镜像：`ELECTRON_BUILDER_BINARIES_MIRROR` / `ELECTRON_MIRROR` 指向
  npmmirror；后台静默跑构建会被会话回收——**前台跑**

## 3. 验收

- [ ] 干净 Windows 机器（或新目录）跑打包产物可连接设备（待装机实测；
      本机 release/win-unpacked 已可运行）
- [x] README 按步骤可完成 M2 级操作（使用概览六步覆盖连接→操控→宏→远程）

## 4. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-10-20 | NSIS `NS2Studio-Setup-0.1.0.exe` / Portable 0.1.0 出包成功（102MB）；图标、LICENSE、声明、打包配置落齐 |

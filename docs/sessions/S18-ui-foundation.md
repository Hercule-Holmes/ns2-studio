# S18 - UI Foundation (Switch 风格 + 双主题)

Status: in progress
Owns: `apps/desktop/src/renderer/styles.css`、`apps/desktop/src/renderer/components/ui/**`、
`apps/desktop/src/renderer/components/SidebarNav.vue`、`apps/desktop/src/renderer/router.ts`、
`apps/desktop/src/renderer/composables/use-theme.ts`、`apps/desktop/src/renderer/pages/DevicePage.vue`（样板迁移）、
`apps/desktop/src/renderer/pages/SettingsPage.vue`（主题切换）、`src/shared/ipc.ts`（AppSettings.theme）
上下文注入: docs/architecture/04-SESSION-MATRIX.md、INTEGRATION.md、现状 styles.css / DevicePage.vue / SidebarNav.vue

## 背景

现有 UI 为工程师默认暗色主题：无视觉身份、表单堆砌、无图标体系、组件样式在各页
scoped style 中重复。S19/S20 将新增游玩记录页，为避免新页在旧风格上写完再迁移，
本 session 先建立 Switch 主机风格的 UI 基建。

## 决策

- 方向：Switch 主机 UI 语言（反色选中、胶囊按钮、大圆角卡片、近无彩 + 语义色点缀、
  品牌红 #e60012 仅主操作）。
- 双主题：dark（默认）/ light，CSS 变量按 `html[data-theme]` 切换；主题持久化在
  settings.json 的 `AppSettings.theme`（新增字段，沿用 settings:get/update IPC）。
- 组件：自建 `components/ui/`（不引入组件库）；图标 lucide-vue-next（唯一新依赖）。
- 样板：DevicePage 迁移为新风格样板页，验证组件覆盖度；其余旧页 S20 迁移。

## 任务清单

- [x] 设计 token：双主题 CSS 变量 + 旧变量名别名（未迁移页不断供）
- [x] ui/ 组件：AppButton / AppCard / AppSelect / AppInput / EmptyState /
      SectionHeader / StatusLight（迁入 ui/）
- [x] 侧边栏：lucide 图标 + 反色选中胶囊；NavItem 增加 icon
- [x] 主题：use-theme composable + main.ts 启动应用 + SettingsPage 切换
- [x] DevicePage 样板迁移
- [x] SESSION-MATRIX 登记（S18）
- [x] typecheck + vitest

## 验收

- 双主题下 DevicePage 渲染正常（截图比对）
- typecheck / vitest 绿
- 未迁移页面在双主题下不破（旧变量别名生效）

## 不做

- 其余旧页面迁移（S20）
- 游玩记录页（S19）
- 浅色主题的像素级 Switch 还原（先做到"同体系、可日常用"）

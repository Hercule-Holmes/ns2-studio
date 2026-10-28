# S20 - Playtime Page + Migration

Status: in progress（页面功能完成；旧 5 页迁移为后续小任务）
Owns: `apps/desktop/src/renderer/pages/PlaytimePage.vue`、router 注册、
旧页迁移（Pad/Timeline/Amiibo/Remote/Settings — 游玩记录外）
上下文注入: S18-ui-foundation（token/组件）、S19-playtime（数据核心）

## 任务清单

- [x] PlaytimePage.vue：账号管理（添加/删除/单独同步）+ 全部合计/按账号视图 +
      汇总卡 + 每日列表（封面 dataURL）+ 进度显示
- [x] 路由注册（CalendarClock 图标）
- [ ] 旧 5 页换新装（S18 样板模式的重复劳动，独立小任务）

## 验收

- PlaytimePage 未登录/已登录双态渲染正常
- typecheck / vitest 绿

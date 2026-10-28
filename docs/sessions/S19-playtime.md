# S19/S20 - Nintendo Playtime (Parental Controls API)

Status: in progress (非实机验证版本 — API flow implemented per community docs
(ZekeSnider/NintendoSwitchRESTAPI), not yet verified against a live account)
Owns: `apps/desktop/src/main/nintendo/**`、`apps/desktop/src/shared/channels-nintendo.ts`、
`apps/desktop/src/renderer/pages/PlaytimePage.vue`
上下文注入: docs/architecture/04-SESSION-MATRIX.md、INTEGRATION.md、
https://github.com/ZekeSnider/NintendoSwitchRestAPI（OAuth + DailySummaries 文档）

## 背景

任天堂无开放 API；家长控制 App 的 REST API 被社区逆向（读自己账号数据，
不触碰主机/存档，无封号案例）。本 session 把「游玩时长 + 封面」接进
NS2 Studio，支持多账号合并/单独查看。

## 决策

- 红线：只读自己账号的家长控制数据；不碰主机、不碰存档、不做 CFW。
- 多账号：id_token.sub 为稳定键；原始日汇总按账号隔离存储，合并在查询层求和。
- 凭据：session_token 走 Electron safeStorage 加密（不可用时 base64 明文降级）。
- 回填：首次同步按 updatedAt 游标向历史翻页至耗尽；之后增量。
- 覆盖：经主进程带授权下载后本地缓存，IPC 返回 dataURL。

## 任务清单

S19（数据核心）
- [x] channels-nintendo + shared/ipc NintendoApi 契约
- [x] oauth.ts：PKCE / 登录 URL / session_token 交换（纯函数可测）
- [x] auth.ts：BrowserWindow 登录流（拦截 npf71b963c1b7b6d119://auth 回跳）
- [x] api-client.ts：token 链 + DailySummaries 翻页 + user/me
- [x] account-store.ts：safeStorage 多账号存储 + 日汇总缓存 + 封面缓存
- [x] merge.ts：跨账号按日/按游戏求和（纯函数可测）
- [x] service.ts：TypedEmitter 门面（addAccount/remove/syncAll/data/cover）
- [x] IPC 注册 + preload 桥 + index.ts 组装
- [x] 单测：oauth / account-store / merge

S20（页面）
- [x] PlaytimePage.vue：账号管理 + 全部合计/按账号视图 + 每日列表（封面）
- [x] 路由 + 图标（CalendarClock）
- [x] SESSION-MATRIX 登记 S19/S20

## 验收

- typecheck / vitest 绿（API 流程标注"非实机验证"）
- 未登录/已登录双态渲染正常

## 不做

- 自动定时同步（手动按钮先行）
- remote-client 手机端展示
- 实机账号验证（需要真实登录，标注非实机验证版本）

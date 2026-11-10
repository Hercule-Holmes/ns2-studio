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
  → **2026-10-21 改为系统默认浏览器登录**：Electron 内嵌窗口中 Nintendo
  登录页的 Passkey 条件式自动弹窗死循环（无法输入密码）。新流程：
  `createPendingLogin()` 生成 PKCE → `shell.openExternal` 打开默认浏览器
  （可用浏览器保存的密码/Passkey/2FA）→ OS 以
  `npf71b963c1b7b6d119://auth` 深链拉起应用（需注册协议处理者）→
  `handleDeepLink` 校验 state 并交换 token。配套：单实例锁、
  dev 运行时协议注册、安装版 build.protocols、5 分钟超时。
  限制：应用未运行时点开链接会冷启动但无 pending 上下文，需从应用重新发起。
- [x] api-client.ts：token 链 + DailySummaries 拉取 + user/me
  → **2026-10-21 重写为 moon API（みまもり plus/ZNMA，client 54789befb391a838）**：
  真机验证发现游玩时长在 plus 应用身份下（旧 71b963 客户端无 moon API 权限），
  且旧 scope 列表已被 Nintendo 下线（authorize 报「要求无效/要求的内容有误」）。
  对照 nxapi（samuelthomas2774/nxapi，AGPL——仅参数与流程对照，未复制代码）
  src/api/moon.ts 重写：authorize scope=moon* 系列 + theme=login_form +
  redirect=npf54789befb391a838://auth（协议注册同步更新）；api/token 用 JSON
  body + Dalvik UA；users/me 用 access_token 取 naId；设备列表 → 逐设备
  /v1/devices/{id}/daily_summaries（无游标，返回全窗口，按日期 upsert）；
  每游戏时长在 devicePlayers[].playedApps[].playingTime；封面为直链 CDN。
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

## 真机验证记录（2026-10-21）

**已打通**：系统浏览器登录全链路（ZNMA 授权 → 深链回跳 → session_token →
NA token → users/me），账号「赫尔克里」成功入库（safeStorage 加密存储），
登录方式已从内嵌窗口改为系统默认浏览器（修复 Passkey 弹窗死循环）。

**阻塞：游玩数据同步**。Nintendo 已将 みまもり 服务迁移至新体系，社区全部
工具（nxapi、pynintendoparental、HA 集成）迁移后均未跟进。实测矩阵：

| 尝试 | 结果 |
|------|------|
| 旧 moon API（api-lp1.pctl/moon；1.17/1.20/2.6.0 版本、多 build、en-GB/zh-CN 头） | 400 `update_required`（服务强制下线） |
| 新 ZNMA 主机（app.lp1.znma）+ id_token Bearer，/v2、/v3、多路径前缀 | 404 `resource_is_not_found` |
| 新 ZNMA 主机 + access_token Bearer | 403 `forbidden` |
| 新 ZNMA 主机 + 旧 moon 路径 | 503 upstream 断连（旧后端确认已死） |

**下一步（需要新情报）**：
1. 对真机 みまもり Switch App 抓包（mitmproxy + 安卓），拿到现行 v2/v3
   actions 的确切路径、必需头与令牌类型
2. 或跟踪 nxapi GitLab 主仓库（samuel/nxapi）与 pynintendoparental 的后续
   适配提交（两者当前均停留在迁移前状态，nxapi 主线 7 周未动）
3. 应用层已就绪：登录/存储/UI/错误路径完备，API 客户端为单类可替换设计
   （`ParentalClient`），端点对齐后即可通

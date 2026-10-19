# S13 — 远程桥（Gateway / remote 源 / 鉴权）

| 字段 | 值 |
|------|-----|
| **Status** | `in_progress`（代码+单测完成，真机/手机联调待验） |
| **Priority** | P1 |
| **Depends on** | S3（InputHub）、S2（壳/IPC） |
| **Blocks** | S14、S15、S16 |
| **Owns** | `apps/desktop/src/main/remote/**`、`shared/channels-remote.ts`、`pages/RemotePage.vue` |
| **Estimate** | 1–2 天 |

> 契约：[08-REMOTE.md](../architecture/08-REMOTE.md)。本 Session 改动 `HubSource`
> 公共类型（+`"remote"`），已先修订 01 §4 / 03 §6。

## 1. 目标

Main 进程内嵌 HTTP/WS 服务：静态托管手机控制页（S14 产物）、token 鉴权、
`pad` 上行接入 `InputHub` 新 `remote` 源、单会话互斥、断开/看门狗自动
中立化；桌面端提供开关/二维码/会话状态管理页。

## 2. 上下文注入

- `08-REMOTE.md` 全文（消息协议/安全模型/拓扑）
- `hub/input-hub.ts`（`applyFrom` 门控、切源 neutral 语义）
- `config/config-store.ts`（AppConfig 默认值与深合并）
- `ipc/register.ts` + `preload/index.ts`（通道注册与白名单模式）
- `docs/lab-notes/wake-research.md`（wake 占位决策 D3）

## 3. 任务清单

- [x] `shared/ipc.ts`：`HubSource` +`"remote"`；`RemoteStatus`/`RemoteClientInfo`/`RemoteApi` 类型
- [x] `shared/channels-remote.ts`：`getStatus/setEnabled/rotateToken/stateChanged/clientChanged/signal/urls`
- [x] `config-store.ts`：`remote` 默认段；首次生成 token（`crypto.randomBytes(16)`）
- [x] `main/remote/gateway.ts`：http 静态 + ws、auth、pad 校验、单会话、
      看门狗、断开→neutral+idle、`wake` 占位响应、`signal` 透传
- [x] `main/index.ts` 组装（enable/port 变更需重启服务）、`before-quit` 关闭
- [x] `ipc/register.ts` + `preload` 暴露 `window.api.remote`
- [x] `pages/RemotePage.vue`：开关/端口/token/重新生成/QR/可达地址/会话状态
- [x] `router.ts` 导航加「远程」
- [x] 单测 `test/remote-gateway.test.ts`：auth、pad 门控、断开、看门狗、busy

## 4. 验收

- [ ] 单测全绿（含 gateway 新增用例）
- [ ] `NS2_STUDIO_MOCK_SERIAL=1` 下：桌面开远程 → 手机同 WiFi 扫码 →
      授权 → 接管 → 手机按键在桌面 hex 日志可见
- [ ] 手机锁屏/断网 → 桌面端 1s 内自动中立并回 `idle`
- [ ] 第二台设备连接收到 `busy`

## 5. 不做

- WebRTC 视频（S15）
- 多客户端/抢占（v1 单会话）
- HTTPS/WSS（公网走 Tailscale 加密）

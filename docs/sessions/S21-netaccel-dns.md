# S21 - netaccel：eShop DNS 优选加速（v1）

Status: in progress（v1 = DNS 优选 + 桌面管理页；代理/多连接归 v2/v3）
Owns: `apps/desktop/src/main/netaccel/**`、`apps/desktop/src/shared/channels-netaccel.ts`、
`apps/desktop/src/renderer/pages/AccelPage.vue`
上下文注入: docs/architecture/08-REMOTE.md（08 不含本 session；加速独立于远程桥）、
SwitchBrew Network（CDN 域名表）、r/NintendoSwitch TCP window 帖（v2 依据，本期不实现）

## 背景

非国行 NS2 的 eShop/下载全部走 Akamai 全球 CDN（`atum.hac.lp1.d4c.nintendo.net`
等，约 306 个候选 IP）。国内运营商 DNS 常把任天堂域名调度到远端节点，且 Switch
系 TCP 接收窗口小，高 RTT 链路上吞吐被 BDP 锁死 → 商店加载慢、下载慢。

思路（社区同款：CloudflareSpeedTest「优选 IP」）：**测一圈候选节点延迟，谁快就让
NS2 从谁下载**。DNS 解析结果决定 CDN 节点分配 → 在 PC 上做一台"智能 DNS"，
对任天堂 CDN 域名直接回答测速最优 IP，其余域名透传上游。

为什么放 PC 而不是手机 app：Unix 系（含 Android/iOS）普通进程不能绑 <1024 特权
端口（DNS 必须 :53），Windows 无此限制；且 PC 与 NS2 同一家宽出口，测速结果
就是 NS2 将走的真实路径。

## 决策

- 红线：只覆盖 CDN 内容域名（`atum/atumn.hac.lp1.d4c.nintendo.net`）的 **A 记录**；
  不碰 TLS（SNI 透传、证书端到端校验）；认证域名（dauth/aauth 等）不加速。
- **降级优先**：NS2 侧配「主 DNS=PC，副 DNS=公共」→ PC 关机自动落回副 DNS，
  本功能最大故障代价 = 退化成现状。
- **TLS 验证前置**：候选 IP 先带正确 SNI 做握手并通过证书校验才可成为 best；
  全部验证失败 → best=null（不加速，转发上游），绝不回填未验证节点。
- **测速指标 = TCP connect 443 耗时中位数**（Akamai 对 ICMP 不友好，不用 ping）。
- **无新依赖**：DNS 报文编解码/UDP 客户端/服务器全部用 `dgram` + 自写 wire
  format（`dns-packet.ts`，纯函数可测）。
- **持久化**：`userData/netaccel/nodes.json`；启动时若表空或 >6h 旧则自动补测。
- **加速引擎独立于远程桥**：不做手机端控制面（曾做过手机面板后裁撤——引擎全在
  PC，桌面「网络加速」页即可覆盖管理需求；WS accel-* 协议一并移除）。
- 事件仅在下述时机广播 stateChanged：启停 / 测速起止 / 表更新。每 query 计数器
  只进按需快照（IPC getStatus）。

## 任务清单

- [x] `channels-netaccel.ts` + `shared/ipc.ts`：AccelApi / AccelStatus / NodeRecord / Progress 契约
- [x] `AppConfig.netaccel`：{ enabled, port(53), upstreamDns, domains? } + 默认值
- [x] `netaccel/dns-packet.ts`：encodeQuery / decodeMessage（含压缩指针）/ encodeResponse 纯函数
- [x] `netaccel/accel-domains.ts`：加速域名表（atum/atumn）+ isAcceleratedDomain
- [x] `netaccel/resolver.ts`：resolveA（UDP，ID 匹配 + 超时）/ collectCandidates（多 DNS 并发取并集）
- [x] `netaccel/speedtest.ts`：probeTcpMedian / verifyTls(SNI+证书) / rankNodes（并发池 + top-K 验证）
- [x] `netaccel/dns-server.ts`：UDP:53 服务器；加速域名合成应答；其余逐 query 转发（独立上游 socket，4s 超时）
- [x] `netaccel/store.ts`：nodes.json 读写
- [x] `netaccel/service.ts`：TypedEmitter 门面 start/stop/setEnabled/runSpeedtest/getStatus + 自动补测 + 计数器
- [x] IPC 注册 + preload `netaccel` 桥 + index.ts 组装（enabled 自启 / before-quit dispose）
- [x] 桌面「网络加速」页 AccelPage.vue：启停 / 测速 / 进度 / NS2 DNS 配置指引 / 节点排名表 / 路由+图标
- [x] 单测：dns-packet / resolver / speedtest / dns-server / service（全部可离线跑）
- [x] SESSION-MATRIX 登记

## 验收

- [x] `pnpm --filter @ns2-studio/desktop typecheck` 绿
- [x] `pnpm --filter @ns2-studio/desktop test` 绿
- [ ] 实机：NS2 主 DNS 指 PC 后 eShop 可浏览、下载速度对比（需真机）

## 不做（后续 session）

- v2：CONNECT 代理（RTT 切分，TCP window 问题的对症解）
- v3：多连接 Range 拼接下载（商业加速器「多线程」）
- 定时重测调度（当前仅启动补测 + 手动触发）
- 手机端控制面（已裁撤：引擎全在 PC，远程桥无 accel 协议；将来要做再加回）
- IPv6 / DNS-over-HTTPS 上游

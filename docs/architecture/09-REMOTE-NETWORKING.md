# 09 — 远程组网与穿透原理（NAT · 打洞 · DERP · Tailscale 实战）

> 本文回答一个问题：**为什么手机在 4G 上远程操控家里的 NS2，延迟从 500–2000ms
> 降到了 26ms**。由浅入深分六层：物理路径 → NAT → 打洞 → 本项目实战 →
> 物理验证 → 应用层韧性。所有数据来自 2026-10-19/20 真机实测（S16，
> 实录见 `lab-notes/S16-tailscale-punch.md`）。
>
> 读者前提：不需要网络专业背景；每层只用上一层引入的概念。

---

## 1. 现象层：延迟 = 数据走的路

远程操控的延迟，大头不是软件，而是**数据包走过的物理路径**。

### 1.1 两种路径

```text
改进前（中继）：
  手机(4G) ──► 运营商骨干 ──► 🇺🇸旧金山 DERP 中继 ──► 运营商骨干 ──► 家宽 ──► PC
                                    （绕地球半圈，RTT 500–2000ms）

改进后（直连）：
  手机(4G) ──► 运营商骨干 ──► 家宽公网入口 ──► 光猫 ──► PC
                                    （省内往返，RTT 26ms）
```

### 1.2 延迟的物理构成

一个包的 RTT 由三部分叠加：

| 成分 | 来源 | 量级 |
|------|------|------|
| 传播延迟 | 光在光纤里约 **200,000 km/s**（真空光速的 2/3），≈ **200km/ms** | 距离 ÷ 200 |
| 转发延迟 | 每台路由器/基站查表转发 | 每跳 0.05–1ms，一条路径 10–20 跳 |
| **排队延迟** | 链路/服务器拥塞时包在缓冲区排队 | **0 → 数千 ms，唯一不可控项** |

算一笔账（实测对账）：

- 家 ↔ 旧金山单程 ≈ 10,000km → 传播 50ms 单向，**RTT 理论下限 ≈ 100ms**；
  实测 ping DERP = 161ms（含排队），数据再从中继绕回又翻倍 → 500ms 起。
- 家 ↔ 手机 4G 出口 ≈ 数百到数千公里 → **实测直连 26ms**。

**结论：中继路径的延迟下限被物理距离锁死，软件优化追不平；唯一出路是别绕路。**

---

## 2. 背景层：NAT——为什么不能直接连

### 2.1 IPv4 枯竭与 NAT 的诞生

IPv4 只有约 43 亿个地址，远少于全球联网设备。NAT（Network Address
Translation，网络地址转换）让**一撮设备共享一个公网 IPv4**：

```text
公网视角：113.86.x.x（运营商分给光猫的唯一门牌）
  └─ 光猫 NAT：192.168.1.1/24
       ├─ PC        192.168.1.6
       └─ 手机WiFi  192.168.1.7（若在家）

4G 侧更夸张（CGNAT，Carrier-Grade NAT）：
运营商把几万手机用户共享一小撮公网 IP —— 手机也没有自己的公网门牌
```

### 2.2 NAT 的关键行为：只许出、不许进

内网设备**主动**向外发包时，NAT 生成一条映射并记住：

```text
PC:41641 ──发往任意目的地──► NAT 记录: 公网113.86.x.x:35237 ↔ PC:41641
                              （此后外部发到 113.86.x.x:35237 的回包放行）
```

副作用：**外部无法主动敲门**。PC 和手机都躲在 NAT 后面，互相敲门谁也敲不进
——这就是打洞问题要解决的核心矛盾。

### 2.3 NAT 行为分类（RFC 4787，决定打洞成败）

NAT 有两个独立维度，组合出四种性格：

| 映射维度（出站） | 含义 |
|------------------|------|
| **EIM** endpoint-independent mapping | 不管发往谁，同一个内网端口永远映射到**同一个**公网端口 |
| **SDM** symmetric mapping | 每换一个目的地就换一个公网端口（最严） |

| 过滤维度（入站） | 含义 |
|------------------|------|
| **EAF** endpoint-independent filtering | 谁发来的都收 |
| **ADF/SDF** (addr/port)-dependent filtering | 只收「我发过包的那个目的地」（或那个端口）来的 |

传统叫法：full cone（EIM+EAF）、restricted cone（EIM+ADF）、port-restricted
cone（EIM+SDF）、**symmetric（SDM+*，打洞最难）**。

**打洞成功率矩阵**（任一侧 symmetric 就很难；两侧都严则基本必败）：

| 手机侧 ↓ / PC 侧 → | EIM | SDM |
|--------------------|-----|-----|
| EIM | ✅ 容易 | ⭕ 看过滤 |
| SDM（4G CGNAT 常见） | ⭕ 看过滤/运气 | ❌ 几乎不可能 |

本项目实测：PC 侧 `MappingVariesByDestIP: false` = **EIM**（友好）；
手机 4G CGNAT 行为不受我们控制——这就是为什么要在 PC 侧做文章（§5）。

---

## 3. 核心层：UDP 打洞（hole punching）

### 3.1 工具：STUN——「我的公网形象是什么」

STUN（RFC 5389）：客户端向公网 STUN 服务器发一个 UDP Binding Request，
服务器把自己看到的来源地址（`XOR-MAPPED-ADDRESS`）原样回答。于是内网设备
**不用登路由器**就知道自己的公网形象：

```text
PC ──Binding Request──► STUN 服务器
PC ◄──"你是 113.86.62.49:35237"────
```

向多个不同 STUN 服务器探测，对比映射是否一致，即可判定 EIM/SDM——
`tailscale netcheck` 的 `MappingVariesByDestIP` 就是这么测的。

### 3.2 三人信令模型

NAT 后的双方无法互相发现，需要第三方介绍：

```text
        ┌──────────────┐
        │  介绍人/信令   │   Tailscale：DERP + 协调服务器
        │ （只传信令）   │   WebRTC：你自己的信令通路（remote:signal）
        └──┬────────┬──┘
           │ ①交换双方公网端点
     ┌─────┴─┐    ┌─┴─────┐
     │ PC    │    │ 手机   │
     └───┬───┘    └───┬───┘
         │ ②同时向对方端点发包（凿洞）
         ▼◄───────────►▼
        ③洞对上洞 → 直连，介绍人退场
```

### 3.3 逐步包流程（以本机实测参数为例）

```text
前置（STUN）：PC 得知自己形象 = 113.86.x.x:35237（EIM：发谁都这个口）
              手机得知自己形象 = 113.84.x.x:27310（CGNAT 分配）

①信令交换（经 DERP/协调服务器，几字节 JSON）：
   PC  知道：手机在 113.84.138.209:27310
   手机知道：PC 在 113.86.x.x:35237

②同时互发 UDP 探测（disco/STUN binding）：
   PC:41641 ──► 113.84.138.209:27310
     光猫 NAT：为「41641→手机端点」凿洞（EIM：复用/新建公网口）
   手机:27310 ──► 113.86.x.x:35237
     CGNAT：手机此前发过包到 35237（信令期 STUN/心跳），洞已存在

③任意一侧的包先到达对端 NAT：
   查过滤表 → 「这个来源我主动发过包」→ 放行 → 直连建立
   WireGuard 握手在直连上完成 → 数据面切换，DERP 退场
```

### 3.4 失败模式清单

| 模式 | 原因 | 兜底 |
|------|------|------|
| 一侧 SDM（对称） | 洞的端口对不上 | 反复重探碰运气 / 中继 |
| 双侧 port-restricted + 时序错 | 洞没同时凿开 | 加大探测频率（disco 就是这么做的） |
| UDP 被防火墙/运营商过滤 | 洞凿不出来 | 只能中继（TCP 兜底） |
| 任何打洞失败 | — | **DERP 中继**（下节） |

---

## 4. 中继层：DERP——最后的兜底

打洞不是 100% 成功，Tailscale 自建全球中继网 DERP（Designated Encrypted
Relay for Peers）：

- **数据面**：DERP 上跑的是**加密后的 WireGuard 包**——中继看得见密文，
  看不见内容（端到端加密由 WireGuard 密钥保证，中继无密钥）
- **选址**：客户端按延迟选最近 DERP。**大陆无官方 DERP 节点**，
  本机最近的是旧金山（161ms）→ 一旦走中继，物理下限就是 300ms+ RTT
- **角色切换**：DERP 同时是「信令介绍人」——打洞用的端点交换也走它；
  打洞成功后数据面切直连，DERP 只剩心跳级流量

这就是本次「掉线 + 高延迟」的完整解释链：**双侧打洞失败 → 全部数据绕美国
→ 6Mbps 视频灌爆中继带宽 → 队列堆积延迟雪崩 → 停顿超 1s → 应用层看门狗
误判掉线**。

---

## 5. 实战层：本项目从 500ms 到 26ms 的完整棋局

### 5.1 拓扑确认

`192.168.1.1` 是**电信天翼光猫**（一体化网关，LuCI 定制固件）——单层 NAT，
**没有第二台路由器**。这意味着光猫上加的端口映射直接挂在公网入口，一次到位。
PC 固定 `192.168.1.6`（建议在光猫上做 IP-MAC 绑定，防止 DHCP 挪窝）。

### 5.2 诊断（`tailscale` 三板斧）

```text
$ tailscale status
  100.124.65.77  xiaomi-17-pro  active; relay "sfo"      ← 走中继实锤

$ tailscale netcheck
  UDP: true                                    ← 出口能发 UDP
  IPv4: yes, 113.86.62.49:35237                ← 公网形象（EIM）
  MappingVariesByDestIP: false                 ← PC 侧 EIM，打洞友好 ⭐
  PortMapping: (空)                            ← UPnP/NAT-PMP 没开 ⭐
  最近 DERP: sfo 161ms                          ← 中继物理下限

$ tailscale ping --c 4 100.124.65.77
  pong ... via DERP(sfo) in ~500ms ×4
  direct connection not established            ← 打洞失败实锤
```

诊断结论：**PC 侧友好但无固定靶子 + 手机侧 CGNAT 严 → 打洞成功率趋零。**
可控变量只有一个：把 PC 侧变成「固定靶子」。

### 5.3 杀招：静态端口映射（给 PC 挂永久门牌）

在光猫上加映射：**公网 UDP 41641 → 192.168.1.6:41641**（41641 是
Tailscale 的默认 WireGuard 监听端口）。

效果：无论 NAT 状态如何，**公网上发到 `113.86.x.x:41641` 的 UDP 包必然
送达 PC 的 Tailscale**。PC 从「躲着的」变成「挂了门牌的」——对端的探测
包必达，握手一步到位；即便某次对称 NAT 抖动，重探也有稳定落点。

> **为什么这样做是安全的**：41641 上只有 WireGuard。每个包都必须通过
> Curve25519/XChaCha20 密钥协商的加密门禁，没有合法密钥的包被静默丢弃。
> 这与「把 8787 HTTP 网关映射到公网」有本质区别——后者是明文应用面，
> 绝对禁止（见 08-REMOTE §5）。

### 5.4 自动化：天翼网关 LuCI 私有 API

光猫是 LuCI 定制固件，Web 界面的「协议下拉」只显示 TCP，但**后端 API 照收
UDP**（前端限制 ≠ 后端限制）。抓包分析出的调用序列（仅限局域网明文）：

```text
①登录
  POST /cgi-bin/luci
  body: username=useradmin&psd=<明文密码>
  ← 302 + Set-Cookie: sysauth=<token>; path=/cgi-bin/luci/

②加映射
  POST /cgi-bin/luci/admin/settings/pmSetSingle   （Cookie: sysauth=...）
  body: token=<页面CSRF>&op=add&srvname=ns2-tailscale
        &client=192.168.1.6&protocol=UDP&exPort=41641&inPort=41641
  ← {"retVal":0}

③查询
  GET /cgi-bin/luci/admin/settings/pmDisplay
  ← {"pmRule1":{"protocol":"UDP","exPort":41641,...,"enable":1},"count":1}
```

踩坑记录：
- PowerShell `Invoke-WebRequest` 对该固件的 Cookie 处理有 bug（带了 Cookie
  仍返回登录页），换 `curl.exe` 手动 `Cookie:` 头即正常
- 错误密码返回 `200` + 登录页；正确密码返回 `302` + cookie——用这个差异做
  自动化成败判定
- `PortMapping` 为空是因为光猫不开 UPnP/NAT-PMP；**静态 DNAT 不会出现在
  netcheck 的 PortMapping 里**，验证靠实际 ping 而不是 netcheck

### 5.5 结果

```text
$ tailscale debug rebind        # 强制重新探测端点
$ tailscale ping --c 8 100.124.65.77
  pong from xiaomi-17-pro via 113.84.138.209:27310 in 26ms
```

`via 113.84.138.209:27310` = 手机 4G 的 CGNAT 公网端点——**直连**。
**500–2000ms → 26ms（约 20–70 倍改善）**。

### 5.6 长期可选项：自建 DERP

打洞有随机性（运营商侧不可控）。若希望「打洞失败时」的兜底也不烂：
自建国内/香港 VPS 跑 DERP 节点，中继延迟 500ms → 30–80ms。Tailscale 支持
自定义 DERPMap。属可选项，当前未部署。

---

## 6. 应用层：韧性设计（为什么体验「稳」而不只是「快」）

ns2-studio 侧的三道防御，保证网络层波动不直接击穿用户体验：

### 6.1 RTT 自适应看门狗（防误杀掉线）

- 机制：手机心跳（`ping`）携带实测 RTT；网关阈值 = `max(watchdogMs, rtt×6)`
- 位置：`main/remote/gateway.ts`（armWatchdog）
- 效果：DERP 路径 RTT≈500ms 时阈值放宽到 3s，网络抖动不再掐断会话；
  LAN RTT≈5ms 时仍是 1s 快速释放，卡键安全性不降级

### 6.2 WebRTC 码率阶梯（防延迟雪崩）

- 机制：每 2s 读 `RTCRtpSender.getStats()`：
  - `outbound-rtp.bytesSent` 差分 → 实际发送速率（编码饥饿检测）
  - `remote-inbound-rtp.fractionLost / roundTripTime` → 丢包/RTT
- 降档条件：丢包 > 5% 或 RTT > 400ms 或实际速率 < 目标 55%
- 阶梯：6M → 3M → 1.5M → 800k → 400k；连续 3 次干净则逐级升回
- 位置：`renderer/remote/video-stream.ts`；RemotePage 实时显示「码率/丢包/RTT」
- 原理：中继带宽不足时，编码器硬塞 6Mbps 只会让队列无限堆积（延迟雪崩）；
  主动降到链路能承受的水平，牺牲清晰度保住实时性——**对操控场景这是正确的取舍**

### 6.3 低延迟播放（手机端）

- `receiver.jitterBufferTarget = 0`：禁用手机端抖动缓冲（默认 100ms+）
- 取舍：牺牲抗抖动换实时；配合 §6.2 的降档让抖动源本身变小

### 6.4 运维速查（网络层）

| 症状 | 判定 | 处置 |
|------|------|------|
| 远程页 RTT 突然 > 300ms | 退回 DERP 了 | PC 跑 `tailscale ping <手机IP>` 触发重探 |
| 重探仍 DERP | 运营商路径变化 | 复查光猫映射规则还在（pmDisplay）；重启光猫 |
| 控制可用视频卡 | 带宽/码率问题 | 看远程页码率档位，属自适应正常降档 |
| 完全连不上 | 会话层 | 查手机 Tailscale 开关、防火墙放行 |

---

## 7. 一句话总结

> **物理距离决定延迟下限**（直连 26ms vs 中继 500ms，光速不谈判）；
> **NAT 决定能否直连**（给 PC 挂静态门牌，双 NAT 困局单侧破）；
> **应用层决定体验下限**（自适应看门狗 + 码率阶梯 + 零缓冲，路径差时保流畅不保画质）。

## 8. 参考

- RFC 4787 — NAT Behavioral Requirements for Unicast UDP（EIM/SDM、过滤分类）
- RFC 5389 — Session Traversal Utilities for NAT（STUN）
- RFC 8445 / WebRTC ICE — Interactive Connectivity Establishment（候选与连通性检查）
- Tailscale — How NAT traversal works（tailscale.com/blog/how-nat-traversal-works，本主题最佳公开综述）
- Tailscale — DERP 协议与自建指南（tailscale.com/kb/1118/custom-derp-servers）
- 本项目实测记录：[../lab-notes/S16-tailscale-punch.md](../lab-notes/S16-tailscale-punch.md)、
  [../lab-notes/wake-research.md](../lab-notes/wake-research.md)

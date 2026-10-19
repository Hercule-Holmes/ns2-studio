# S16 — Tailscale 打洞与光猫端口映射实录（2026-10-20）

> Status: **4G 直连成功（RTT 26ms）**
> 设备：PC（Windows，网线）+ 小米 17 Pro（4G），同一 Tailscale 账号

## 1. 问题

4G 远程场景 Tailscale 全程走 **DERP sfo 中继**（大陆无 DERP 节点，最近旧金山
161ms）：RTT 500–2000ms，视频 6Mbps 灌爆中继 → 延迟堆积 + 超时掉线。

`tailscale netcheck` 关键结论：

| 项 | 值 | 解读 |
|----|-----|------|
| UDP | true | 出口可发 UDP |
| IPv4 | 113.86.x.x:35237 | 公网出口（广东电信） |
| MappingVariesByDestIP | **false** | PC 侧 EIM（好 NAT），打洞友好 |
| PortMapping | 空 | **路由器 UPnP/NAT-PMP 未启用** |
| 最近 DERP | sfo 161ms | 中继绕美国 |

`tailscale ping` 连续多次 `via DERP(sfo)`、`direct connection not established`。

## 2. 网络拓扑确认

`192.168.1.1` 是**电信天翼光猫**（一体化路由，LuCI 定制固件，非独立 OpenWrt
路由器）——单层 NAT，端口映射加在光猫上即直达公网。PC = `192.168.1.6`。

## 3. 解法：光猫加 UDP 41641 映射（无需超管）

天翼网关 `useradmin` 普通账号即有端口映射功能（高级设置 → 端口映射）。
本次通过其 LuCI 私有 HTTP API 自动化完成（HTTP 明文，仅限局域网）：

```text
POST /cgi-bin/luci
  username=useradmin&psd=<明文密码>
  → 302 + Set-Cookie: sysauth=<token>（path=/cgi-bin/luci/）
POST /cgi-bin/luci/admin/settings/pmSetSingle   （Cookie: sysauth=...）
  token=<页面CSRF>&op=add&srvname=ns2-tailscale&client=192.168.1.6
  &protocol=UDP&exPort=41641&inPort=41641
  → {"retVal":0}
GET /cgi-bin/luci/admin/settings/pmDisplay        （查询已生效映射）
```

- UI 的协议下拉只显示 TCP，但**后端直接接受 `protocol=UDP`**（UI 限制不等于后端限制）
- 踩坑：PowerShell `Invoke-WebRequest` 对该固件的 Cookie 处理有 bug
  （带 Cookie 仍返回登录页），改用 `curl.exe` 手动 `Cookie:` 头后正常
- 生效规则：`pmRule1 = { UDP, exPort 41641 → 192.168.1.6:41641, enable:1 }`
- 安全性：映射的是 Tailscale WireGuard 隧道 UDP 端口（密钥加密），
  不是把 8787 HTTP 暴露公网，无暴露风险

## 4. 结果

```text
tailscale debug rebind
tailscale ping --c 8 100.124.65.77
→ pong via 113.84.138.209:27310 in 26ms    （手机 4G 公网端点，直连）
```

**DERP 500–2000ms → 直连 26ms。**

## 5. 备注

- 打洞有随机性：若某次重连又退回 DERP，先跑 `tailscale ping` 触发重探；
  应用侧已有自适应看门狗（`max(watchdogMs, rtt×6)`）与码率阶梯兜底，
  中继态不会掉线、只是画质降档
- 长期最优解（可选）：国内/香港 VPS 自建 DERP（S16 §4 预留项），
  让「打洞失败」时的兜底从 500ms 降到 ~60ms
- 光猫登录密码若在意，可在「修改登录信息」页更换（本次会话已用完即弃）

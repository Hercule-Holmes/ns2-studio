# S16 — 公网访问（Tailscale）

| 字段 | 值 |
|------|-----|
| **Status** | `ready` |
| **Priority** | P2 |
| **Depends on** | S13 |
| **Owns** | 文档 + RemotePage tailnet IP 展示 |
| **Estimate** | 0.5 天 |

## 1. 目标

外出（4G）场景经 Tailscale 组网远程可达：PC 与手机各装 Tailscale，手机访问
PC tailnet IP（100.x.y.z）:8787，代码零改动。

## 2. 任务清单

- [ ] 文档：Tailscale 安装/登录/手机 App 配置指引（docs 或 RemotePage 内帮助）
- [ ] RemotePage：`os.networkInterfaces()` 区分并标注 Tailscale 接口（100.64/10 网段）
- [ ] Windows 防火墙首次放行指引（RemotePage 内提示卡）
- [ ] 安全说明：禁止将 8787 端口直接映射公网；公网必经 Tailscale 加密

## 3. 验收

- [ ] 手机 4G（Tailscale on）扫码/访问 tailnet URL 可用，延迟可接受
- [ ] 文档覆盖安装、登录、常见 DERP 慢速问题（可选自建 DERP 指引）

## 4. 不做

- 自建 VPS 中继 / TURN（按需另立 RFC）
- 公网直连端口转发

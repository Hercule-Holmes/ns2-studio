# S16 — 公网访问（Tailscale）

| 字段 | 值 |
|------|-----|
| **Status** | `done`（4G 直连 26ms 实测通过；自建 DERP 为可选后置） |
| **Priority** | P2 |
| **Depends on** | S13 |
| **Owns** | 文档 + RemotePage tailnet IP 展示 |
| **Estimate** | 0.5 天 |

## 1. 目标

外出（4G）场景经 Tailscale 组网远程可达：PC 与手机各装 Tailscale，手机访问
PC tailnet IP（100.x.y.z）:8787，代码零改动。

## 2. 任务清单

- [x] 文档：Tailscale 安装/登录/手机 App 配置指引（RemotePage「外出访问」帮助卡内嵌，含下载链接）
- [x] RemotePage：识别并标注 Tailscale 接口（100.64/10 网段 → `RemoteEndpointInfo.kind`，
      下拉框显示「Tailscale · 外出」，LAN 排前；`urls: string[]` → 结构化端点，契约见 shared/ipc.ts）
- [x] Windows 防火墙首次放行指引（帮助卡内提示；服务卡原有提示保留）
- [x] 安全说明：禁止将 8787 端口直接映射公网；公网必经 Tailscale 加密（帮助卡内声明）

## 3. 验收

- [x] 手机 4G（Tailscale on）扫码/访问 tailnet URL 可用，延迟可接受
  → **打洞实录见 `lab-notes/S16-tailscale-punch.md`**：光猫加 UDP 41641 映射
  （useradmin 即可，API 自动化）后 `tailscale ping` 直连 26ms（原 DERP 500ms+）
- [ ] 文档覆盖安装、登录、常见 DERP 慢速问题（可选自建 DERP 指引）
  - 已覆盖安装/登录/防火墙（RemotePage 帮助卡）+ DERP 打洞实录（lab-note）；
    自建 DERP 指引留待 VPS 到位后补

## 4. 不做

- 自建 VPS 中继 / TURN（按需另立 RFC）
- 公网直连端口转发

## 5. 原理与实录

- 原理文档：[architecture/09-REMOTE-NETWORKING.md](../architecture/09-REMOTE-NETWORKING.md)
  （NAT 分类、打洞流程、DERP、天翼光猫 API、应用层韧性设计）
- 实测记录：[lab-notes/S16-tailscale-punch.md](../lab-notes/S16-tailscale-punch.md)

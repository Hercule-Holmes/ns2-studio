# 08 — 远程操控（S13/S14/S15/S16）

> 实现真相源：本文件 + `apps/desktop/src/shared/ipc.ts` / `channels-remote.ts` 测试用例。
> 前置调研：[../lab-notes/wake-research.md](../lab-notes/wake-research.md)（NS 唤醒机制）。

## 1. 目标与非目标

**目标**：手机浏览器经 PC（NS2 Studio）远程操控 NS——虚拟手柄实时玩 + 低延迟视频
（S15）+ 公网可达（S16）。

**非目标（v1）**：

- 手机原生 App / 小程序
- 远程编辑时间轴工程（远程仅触发播放，后置）
- 非同一 Tailscale/局域网外的直连穿透（不自建 TURN/中继）

## 2. 架构与数据流

```text
[手机浏览器]                [PC · NS2 Studio Main]
 虚拟手柄/UI                  ┌────────────────────────────┐
   │ ①WS: pad/source/ping     │ RemoteGateway              │
   ├─────────────────────────▶│  http(静态页) + ws(/ws)     │
   │ ②WS: state/pong/state    │  token 鉴权 · 单会话 · 看门狗 │
   ◀──────────────────────────┤        │                    │
   │ ③WebRTC: 视频(S15)        │        ▼ hub.applyFrom     │
   ◀═════════════════════════╪══ InputHub(source="remote")│
                             │        ▼                   │
                             │  DeviceSvc → Serial → ESP32│
                             └────────────────────────────┘
```

- **指令上行**：手机 → WS → `InputHub` 的 **`remote` 源** → 现有写队列 →
  `protocol.encodeReport` → 串口。**串口协议零改动**。
- **视频下行（S15）**：采集卡 → Renderer `getUserMedia` → RTCPeerConnection
  sendonly → 手机 `<video>`。信令复用 WS（`signal` 消息经 IPC 转发 Renderer）。

## 3. 输出源扩展（契约变更）

`HubSource` 由 `"idle" | "manual" | "forward" | "timeline"` 扩展为：

```ts
export type HubSource = "idle" | "manual" | "forward" | "timeline" | "remote";
```

| source | 触发 | 释放 |
|--------|------|------|
| `remote` | 手机端「接管」动作（`source` 消息） | 会话断开 / 看门狗超时 → `idle` + neutral |

InputHub 仲裁逻辑不变（切源先 neutral）。**Gateway 是唯一允许请求 `remote`
源的入口**；桌面 UI 与手机端一律经由它。

## 4. WS 消息协议 v1

传输：`ws://<ip>:<port>/ws`，JSON 文本帧。所有消息带 `v: 1`（省略视为 1）。

### 4.1 握手（必须）

| 方向 | 消息 | 说明 |
|------|------|------|
| C→S | `{v, type:"auth", token}` | 连接后首条消息；3 次失败断开 |
| S→C | `{v, type:"authOk", hub, device}` | 携带当前 HubState / DeviceStatus 摘要 |
| S→C | `{v, type:"authError"}` | token 不符 |

### 4.2 控制类（需已鉴权）

| 方向 | 消息 | 说明 |
|------|------|------|
| C→S | `{type:"source", source:"remote"}` | 请求接管；仅接受 `"remote"` |
| C→S | `{type:"pad", report:{buttons,hat,lx,ly,rx,ry}}` | 数值域校验后 `applyFrom("remote")` |
| C→S | `{type:"release"}` | 立即下发中立报告（切后台/断开前主动调用） |
| C→S | `{type:"ping", t}` | 心跳；`t` 为客户端毫秒时间戳 |
| S→C | `{type:"pong", t}` | 原样回 `t`，客户端算 RTT |
| C→S | `{type:"wake"}` | 唤醒 NS（D3 决策：固件未实现前的占位） |
| S→C | `{type:"wakeResult", ok:false, code:"firmware-unsupported"}` | 占位响应 |
| S→C | `{type:"state", hub, device}` | Hub/设备状态变化广播 |
| S→C | `{type:"sessionLost", reason:"watchdog"\|"server"}` | 服务端终止会话并关闭连接 |

### 4.3 信令（S15 预留，v1 透传）

| 方向 | 消息 | 说明 |
|------|------|------|
| C→S | `{type:"signal", payload:<object>}` | 不透明 JSON，转发 Renderer |
| S→C | `{type:"signal", payload:<object>}` | Renderer → 手机的信令 |

### 4.4 错误

| 方向 | 消息 |
|------|------|
| S→C | `{type:"error", code:"bad-message"\|"busy"\|"not-authed"\|"bad-source", message?}` |

`busy`：已有活跃会话时拒绝第二个客户端（**单会话**，v1 不做抢占）。

## 5. 安全模型

| 项 | 规则 |
|----|------|
| Token | 32 hex（`crypto.randomBytes(16)`），存 `config.remote.token`；QR 携带 `?t=<token>` |
| 传输 | 局域网内明文 WS（可接受）；公网必经 Tailscale（WireGuard 加密）。**禁止**直接把端口映射到公网 |
| WebRTC | DTLS-SRTP 端到端加密（浏览器强制） |
| 会话 | 单客户端；断开/看门狗 → neutral + `idle` |
| 看门狗 | 会话激活期间 `watchdogMs`（默认 1000ms）内无任何消息 → 强制 neutral + 回 `idle` + `sessionLost` + 断开 |
| 静态页 | 无需 token（仅壳页面），所有控制类消息必须先 `auth` |

## 6. 网络拓扑

| 场景 | 路径 | 说明 |
|------|------|------|
| 家里 | 手机 → WiFi → PC 局域网 IP | 直连 |
| 外出 | 手机(4G) → Tailscale → PC tailnet IP (100.x) | PC/手机各装 Tailscale，代码零改动 |
| QR | `http://<首个可达IP>:<port>/?t=<token>` | 桌面端列出 LAN + Tailscale 接口 |

端口默认 `8787`（`config.remote.port`）。服务绑定 `0.0.0.0`（同时覆盖
LAN 与 tailnet）。Windows 防火墙首次放行提示见 RemotePage。

## 7. AppConfig 扩展（03 §6 增补）

```ts
remote: {
  enabled: boolean;      // 服务开关，默认 false
  port: number;          // 默认 8787
  token: string;         // 首次加载自动生成
  heartbeatMs: number;   // 客户端 ping 间隔，默认 250
  watchdogMs: number;    // 服务端超时，默认 1000
};
```

## 8. 手机端（apps/remote-client）

- 形态：vanilla TS + Vite 静态站，构建产物输出至
  `apps/desktop/out/remote-client`，由 Gateway 托管。
- 输入：触屏虚拟手柄（ABXY/hat/虚拟摇杆/ZLZR/±/HOME/Capture/LR click）；
  **仅变化时发送** `pad`；`ping` 维持心跳。
- 释放保护：`visibilitychange`/`pagehide`/`beforeunload` → 发 `release`；
  服务端看门狗兜底。
- 视频区（S15）与「唤醒 NS」按钮（固件到位前提示不支持）为预留占位。

## 9. 里程碑与 Session

| Session | 内容 | 状态 |
|---------|------|------|
| S13 | 远程桥（Gateway、remote 源、鉴权、看门狗、桌面管理页） | in_progress |
| S14 | 手机控制页（触屏手柄、会话 UI、释放保护） | in_progress |
| S15 | WebRTC 视频下行（采集卡取流、信令、低延迟调优） | ready |
| S16 | 公网访问（Tailscale 指引、防火墙、tailnet IP 展示） | ready |

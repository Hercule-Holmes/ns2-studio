import "./style.css";
import { PadInputState } from "./state";
import { wireGamepad } from "./gamepad";
import { RemoteLink, type HubDeviceState } from "./link";
import { VideoClient, type VideoClientState } from "./video";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const gateEl = $("gate");
const gateToken = $<HTMLInputElement>("gate-token");
const gateConnect = $<HTMLButtonElement>("gate-connect");
const gateError = $("gate-error");
const stageEl = $("stage");
const stDot = $("st-dot");
const stText = $("st-text");
const stSource = $("st-source");
const stRtt = $("st-rtt");
const btnWake = $<HTMLButtonElement>("btn-wake");
const btnTake = $<HTMLButtonElement>("btn-take");
const videoSlot = $("video-slot");
const videoStateEl = $("video-state");
const btnVideo = $<HTMLButtonElement>("btn-video");
const btnFs = $<HTMLButtonElement>("btn-fs");

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = new PadInputState();
const link = new RemoteLink(window.location.origin);
const videoClient = new VideoClient($<HTMLVideoElement>("video"), {
  send: (payload) => link.sendSignal(payload),
  onState: renderVideoState,
});
let token = sessionStorage.getItem("ns2-remote-token") ?? "";
let lastSent: string | null = null;
let hubSource = "idle";
let deviceState = "disconnected";
let taken = false; // phone currently owns the `remote` hub source
let toastTimer: number | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toast(text: string, ms = 2600): void {
  let el = document.querySelector<HTMLElement>(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el!.style.display = "none";
  }, ms);
}

function setDot(cls: string): void {
  stDot.className = `dot ${cls}`;
}

function renderStatus(): void {
  switch (link.phase) {
    case "ready":
      setDot("ready");
      stText.textContent = `已连接 · 设备${deviceState === "connected" ? "在线" : "离线"}`;
      break;
    case "connecting":
      setDot("connecting");
      stText.textContent = "连接中…";
      break;
    case "lost":
      setDot("connecting");
      stText.textContent = "连接断开，自动重连…";
      break;
    case "error":
      setDot("error");
      stText.textContent = "连接错误";
      break;
    default:
      setDot("");
      stText.textContent = "未连接";
  }
  stSource.textContent = `源: ${hubSource}`;
  stRtt.textContent = link.rttMs !== null ? `${link.rttMs} ms` : "";
  btnTake.textContent = taken ? "断开" : "接管控制";
  btnTake.classList.toggle("primary", !taken);
  btnTake.classList.toggle("danger", taken);
}

function sendPadIfChanged(): void {
  const report = state.report();
  const json = JSON.stringify(report);
  if (json === lastSent) return;
  lastSent = json;
  link.sendPad(report);
}

function renderVideoState(s: VideoClientState, detail?: string): void {
  videoSlot.classList.toggle("live", s === "live");
  switch (s) {
    case "connecting":
      videoStateEl.textContent = "协商中…";
      btnVideo.textContent = "关闭画面";
      break;
    case "live":
      videoStateEl.textContent = "";
      btnVideo.textContent = "关闭画面";
      break;
    case "no-signal":
      videoStateEl.textContent = "无信号（主机休眠或采集卡无输入）";
      btnVideo.textContent = "关闭画面";
      break;
    case "error":
      videoStateEl.textContent = `视频错误：${detail ?? "未知"}`;
      btnVideo.textContent = "开启画面";
      break;
    default:
      videoStateEl.textContent = "无信号";
      btnVideo.textContent = "开启画面";
  }
}

function releaseAll(): void {
  state.reset();
  lastSent = null;
  if (taken) link.release();
}

// ---------------------------------------------------------------------------
// Link callbacks
// ---------------------------------------------------------------------------

link.onPhase = (phase, detail) => {
  renderStatus();
  if (phase === "ready") {
    gateEl.style.display = "none";
    stageEl.style.display = "flex";
    if (detail) toast(detail);
  } else if (phase === "idle") {
    stageEl.style.display = "none";
    gateEl.style.display = "flex";
    taken = false;
    videoClient.stop();
  } else if (phase === "lost") {
    // Orphaned negotiation from the dead socket must not survive a
    // reconnect — otherwise 开启画面 would be stuck at 协商中.
    videoClient.stop();
  } else if (phase === "error" && detail) {
    gateError.textContent = detail;
    toast(detail);
  }
};

link.onState = (s: HubDeviceState) => {
  hubSource = s.hub.activeSource;
  deviceState = s.device.state;
  const nowTaken = hubSource === "remote";
  if (taken && !nowTaken) {
    // Desktop released us (watchdog / manual switch): drop held inputs.
    state.reset();
    lastSent = null;
    toast("控制权已释放");
  }
  taken = nowTaken;
  renderStatus();
};

link.onSessionLost = (reason) => {
  state.reset();
  lastSent = null;
  taken = false;
  videoClient.stop();
  toast(
    reason === "watchdog"
      ? "会话超时已释放（保持心跳即可维持）"
      : "会话已由桌面端结束",
  );
};

link.onWakeResult = (r) => {
  if (r.ok) toast("唤醒指令已发送");
  else toast(r.message ?? "唤醒暂不支持（固件未实现）");
};

link.onSignal = (payload) => {
  void videoClient.handleSignal(payload);
};

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

wireGamepad(stageEl, state, sendPadIfChanged, [
  {
    el: $<HTMLElement>("stick"),
    knob: $<HTMLElement>("stick-knob"),
    set: (x, y) => state.setLeftStick(x, y),
  },
  {
    el: $<HTMLElement>("stick-r"),
    knob: $<HTMLElement>("stick-r-knob"),
    set: (x, y) => state.setRightStick(x, y),
  },
]);

btnTake.addEventListener("click", () => {
  if (link.phase !== "ready") return;
  if (taken) {
    releaseAll();
    link.close();
    gateError.textContent = "";
  } else {
    link.takeOver();
  }
});

btnWake.addEventListener("click", () => {
  if (link.phase !== "ready") return;
  btnWake.disabled = true;
  link.wake();
  window.setTimeout(() => (btnWake.disabled = false), 2000);
});

btnVideo.addEventListener("click", () => {
  if (link.phase !== "ready") return;
  if (videoClient.currentState === "idle") {
    if (!taken) {
      toast("请先接管控制，再开启画面");
      return;
    }
    void videoClient.start();
  } else {
    videoClient.stop();
    link.sendSignal({ kind: "video-stop" });
  }
});

// ---------------------------------------------------------------------------
// Fullscreen mode (S17): request fullscreen + lock landscape + hide the
// status bar. Orientation lock is Android-Chrome only; elsewhere we degrade
// to "hide status bar" only. The tiny ⛶ button stays to toggle back.
// ---------------------------------------------------------------------------

let fsOn = false;

async function setFullscreen(on: boolean): Promise<void> {
  fsOn = on;
  document.body.classList.toggle("fs-mode", on);
  try {
    if (on) {
      await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {
    /* iOS Safari: no element fullscreen — status-bar hiding still applies */
  }
  try {
    const so = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
      unlock?: () => void;
    };
    if (on) await so?.lock?.("landscape");
    else so?.unlock?.();
  } catch {
    /* orientation lock unsupported */
  }
}

btnFs.addEventListener("click", () => {
  void setFullscreen(!fsOn);
});

document.addEventListener("fullscreenchange", () => {
  // User left fullscreen via a system gesture: sync our visual state back.
  if (!document.fullscreenElement && fsOn) void setFullscreen(false);
});

gateConnect.addEventListener("click", () => {
  const value = gateToken.value.trim();
  if (!value) {
    gateError.textContent = "请输入令牌";
    return;
  }
  token = value;
  sessionStorage.setItem("ns2-remote-token", token);
  gateError.textContent = "";
  void link
    .probeConfig()
    .then((cfg) => {
      link.setHeartbeatMs(cfg.heartbeatMs);
      link.connect(token);
    })
    .catch((err: unknown) => {
      gateError.textContent =
        err instanceof Error ? err.message : "无法访问网关服务";
    });
});

// Release protection: backgrounding must never leave a key held. The server
// watchdog (1s) is the second line of defense.
const onLeave = () => {
  if (link.phase === "ready") releaseAll();
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") onLeave();
});
window.addEventListener("pagehide", onLeave);
window.addEventListener("beforeunload", onLeave);

// RTT refresh
window.setInterval(renderStatus, 500);

// ---------------------------------------------------------------------------
// Boot: prefill token from ?t= (QR link) or sessionStorage
// ---------------------------------------------------------------------------

const urlToken = new URLSearchParams(window.location.search).get("t");
if (urlToken) {
  token = urlToken.trim();
  sessionStorage.setItem("ns2-remote-token", token);
}
if (token) {
  gateToken.value = token;
  gateConnect.click();
}
renderStatus();

import "./style.css";
import { PadInputState } from "./state";
import { wireGamepad } from "./gamepad";
import { RemoteLink, type HubDeviceState } from "./link";

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

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const state = new PadInputState();
const link = new RemoteLink(window.location.origin);
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

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

wireGamepad(stageEl, $("stick"), $("stick-knob"), state, sendPadIfChanged);

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

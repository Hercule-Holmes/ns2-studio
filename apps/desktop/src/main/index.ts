import { join, resolve } from "node:path";
import { app, BrowserWindow, session } from "electron";

// S15: LAN WebRTC — mDNS-obfuscated ICE candidates (default on) can be
// unresolvable for phones on routers with client isolation; use real IPs.
app.commandLine.appendSwitch(
  "disable-features",
  "WebRtcHideLocalIpsWithMdns",
);
// 本机代理客户端（mihomo 等）会设置系统代理；electron 跟随系统代理会把
// dev 页面加载和所有 API 请求都塞进代理隧道（localhost 也不例外），
// 导致窗口空白/请求挂起。本应用所有流量都应直连，显式绕过系统代理。
app.commandLine.appendSwitch("proxy-server", "direct://");
import { DeviceService } from "./device/device-service";
import { createSerialLayer } from "./device/serial-factory";
import { SettingsStore } from "./config/store";
import { ConfigStore } from "./config/config-store";
import { FileLogger, describeError } from "./log/file-logger";
import { InputHub } from "./hub/input-hub";
import { AmiiboStore } from "./amiibo/amiibo-store";
import { AmiiboDeviceApi } from "./amiibo/device-api";
import { AmiiboService } from "./amiibo/service";
import { Recorder } from "./recorder/recorder";
import { TimelineEngine } from "./timeline/engine";
import { CaptureService } from "./capture/capture-service";
import { RemoteGateway } from "./remote/gateway";
import { KeepaliveService } from "./remote/keepalive";
import { NetaccelService } from "./netaccel/service";
import { NintendoService } from "./nintendo/service";
import { REDIRECT_SCHEME } from "./nintendo/oauth";
import { NintendoAccountStore, type NintendoCryptor } from "./nintendo/account-store";
import { safeStorage } from "electron";
import { registerIpc } from "./ipc/register";

const device = new DeviceService({
  layerFactory: createSerialLayer,
  hexLog: process.env.NS2_STUDIO_LOG_HEX === "1",
});

const hub = new InputHub(device);

const recorder = new Recorder(
  {
    onReport: (cb) => hub.on("reportSent", cb),
    forceNeutral: () => hub.forceNeutral(),
  },
  { deviceName: "NS2 Pro" },
);

const settings = new SettingsStore(
  join(app.getPath("userData"), "settings.json"),
);

// S11: full AppConfig (§6) at userData/config.json.
const config = new ConfigStore(join(app.getPath("userData"), "config.json"));

// S11: main-process crash / renderer-error log under userData/logs.
const logger = new FileLogger(app.getPath("userData"));
process.on("uncaughtException", (err) => {
  logger.crash("uncaughtException", describeError(err));
});
process.on("unhandledRejection", (reason) => {
  logger.crash("unhandledRejection", describeError(reason));
});
process.on("warning", (warning) => {
  logger.log("warning", warning.message);
});

const amiibo = new AmiiboService(
  new AmiiboStore(join(app.getPath("userData"), "amiibo")),
  new AmiiboDeviceApi(device),
  device,
);

// S6: Main 高分辨率回放引擎。hub/device 以公开契约为界面；amiibo 到点经 S9
// AmiiboService.changeIndex 触发（未接线时引擎内 no-op log）。
const timeline = new TimelineEngine({
  hub,
  device: {
    get isConnected() {
      return device.isConnected;
    },
    onStateChanged: (cb) => device.on("stateChanged", cb),
  },
  changeAmiiboIndex: (slot) => amiibo.changeIndex(slot),
});

// S8: 有线 NS2 Pro 采集转发（node-hid -> PadReport -> hub forward 源）。
const capture = new CaptureService(hub);

// S13: 手机远程桥（08-REMOTE.md）。静态页在 out/remote-client（S14 构建产物）。
const remote = new RemoteGateway({
  hub,
  device,
  config,
  staticDir: join(__dirname, "../remote-client"),
  log: (line) => console.log(line),
});

// S21: netaccel（eShop 下载转发代理）——独立于远程桥，桌面「网络加速」页管理。
const netaccel = new NetaccelService({
  config,
  log: (line) => console.log(line),
});

// B3 (wake-research): keep the NS awake while a remote session is active.
const keepalive = new KeepaliveService(hub, device, config);

// S19: Nintendo playtime (parental controls API, own account only).
const nintendoCryptor: NintendoCryptor = {
  encrypt: (plain) =>
    safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(plain).toString("base64")
      : "plain:" + Buffer.from(plain, "utf8").toString("base64"),
  decrypt: (enc) =>
    enc.startsWith("plain:")
      ? Buffer.from(enc.slice(6), "base64").toString("utf8")
      : safeStorage.decryptString(Buffer.from(enc, "base64")),
};
const nintendo = new NintendoService(
  new NintendoAccountStore(
    join(app.getPath("userData"), "nintendo", "store.json"),
    join(app.getPath("userData"), "nintendo", "covers"),
    nintendoCryptor,
  ),
  nintendoCryptor,
  () => mainWindow,
);

// S19: system-browser login — the app registers as the handler of the
// Switch auth scheme so the default browser can hand the OAuth result back.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const url = argv.find((a) => a.startsWith(REDIRECT_SCHEME));
    if (url) nintendo.handleDeepLink(url);
  });
}

// S15: capture-card video needs camera/mic access inside the renderer. The
// app has no untrusted content (contextIsolation + no remote navigation), so
// auto-grant `media` instead of prompting. Labels in enumerateDevices() also
// require the sync check handler to return true.
function setupMediaPermissions(): void {
  const grant = ["media"] as const;
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback((grant as readonly string[]).includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => (grant as readonly string[]).includes(permission),
  );
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    title: "NS2 Studio",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    console.log("[main] window ready-to-show");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    // 127.0.0.1 instead of localhost: avoids DNS/TUN resolution quirks that
    // can stall the renderer load when a proxy TUN adapter is active.
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL.replace("//localhost", "//127.0.0.1"));
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  if (!gotLock) return;
  setupMediaPermissions();
  registerIpc(device, settings, config, logger, hub, amiibo, recorder, timeline, capture, remote, netaccel, nintendo, () => mainWindow);
  createWindow();
  keepalive.start();
  if (config.get().remote.enabled) {
    void remote.start();
  }
  if (config.get().netaccel.enabled) {
    void netaccel.start();
  }

  // S19: register the Switch auth scheme (dev mode points the handler at
  // electron + this entry); packaged builds get it from build.protocols.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(REDIRECT_SCHEME);
  } else {
    app.setAsDefaultProtocolClient(REDIRECT_SCHEME, process.execPath, [
      resolve(process.argv[1] ?? "."),
    ]);
  }
  // Deep link that cold-started the app: nothing is pending, drop silently.
  const coldUrl = process.argv.find((a) => a.startsWith(REDIRECT_SCHEME));
  if (coldUrl) nintendo.handleDeepLink(coldUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  keepalive.stop();
  void remote.dispose();
  void netaccel.dispose();
  timeline.dispose();
  capture.dispose();
  device.shutdown();
});

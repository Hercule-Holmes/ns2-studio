import { join } from "node:path";
import { app, BrowserWindow } from "electron";
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
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpc(device, settings, config, logger, hub, amiibo, recorder, timeline, capture, () => mainWindow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  timeline.dispose();
  capture.dispose();
  device.shutdown();
});
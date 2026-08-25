import { ipcMain, dialog, BrowserWindow, app } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { PadReport } from "@ns2-studio/pad-types";
import type { CompileResult, Project } from "@ns2-studio/timeline-model";
import type { RecordingSource } from "@ns2-studio/timeline-model";
import {
  AmiiboChannels,
  AppInfoChannels,
  CaptureChannels,
  ConfigChannels,
  DeviceChannels,
  HubChannels,
  LogChannels,
  PadChannels,
  ProjectChannels,
  RecorderChannels,
  SettingsChannels,
  TimelineChannels,
} from "../../shared/channels";
import type {
  AmiiboCapabilities,
  AmiiboProgress,
  CaptureStartResult,
  CaptureStatus,
  DeepPartialAppConfig,
  HubSource,
  HubState,
  LogLine,
  DeviceStatus,
  RecorderState,
  TimelinePlaybackState,
} from "../../shared/ipc";
import { serializeRecording } from "../../shared/nsrec";
import type { DeviceService } from "../device/device-service";
import type { SettingsStore } from "../config/store";
import type { ConfigStore } from "../config/config-store";
import type { FileLogger } from "../log/file-logger";
import type { InputHub } from "../hub/input-hub";
import type { AmiiboService } from "../amiibo/service";
import type { Recorder } from "../recorder/recorder";
import type { TimelineEngine } from "../timeline/engine";
import type { CaptureService } from "../capture/capture-service";
import { listSerialPorts } from "../device/serial-factory";

const MAX_LOG_LINES = 500;

/**
 * Binds the DeviceService / SettingsStore / InputHub / AmiiboService to typed
 * IPC. Log lines are buffered (for replay on subscribe) and pushed live to the
 * window.
 */
export function registerIpc(
  device: DeviceService,
  settings: SettingsStore,
  config: ConfigStore,
  logger: FileLogger,
  hub: InputHub,
  amiibo: AmiiboService,
  recorder: Recorder,
  timeline: TimelineEngine,
  capture: CaptureService,
  getWindow: () => BrowserWindow | null,
): () => void {
  const logBuffer: LogLine[] = [];

  const pushLog = (line: LogLine) => {
    logBuffer.push(line);
    if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
    getWindow()?.webContents.send(LogChannels.line, line);
  };

  const onStateChanged = (status: DeviceStatus) => {
    getWindow()?.webContents.send(DeviceChannels.stateChanged, status);
  };

  const onHubStateChanged = (state: HubState) => {
    getWindow()?.webContents.send(HubChannels.stateChanged, state);
  };

  const onAmiiboProgress = (p: AmiiboProgress) => {
    getWindow()?.webContents.send(AmiiboChannels.progress, p);
  };

  const onAmiiboCapabilitiesChanged = (c: AmiiboCapabilities) => {
    getWindow()?.webContents.send(AmiiboChannels.capabilitiesChanged, c);
  };

  const onRecorderStateChanged = (state: RecorderState) => {
    getWindow()?.webContents.send(RecorderChannels.stateChanged, state);
  };

  const onTimelineTime = (ms: number) => {
    getWindow()?.webContents.send(TimelineChannels.playbackTime, ms);
  };

  const onTimelineStateChanged = (state: TimelinePlaybackState) => {
    getWindow()?.webContents.send(TimelineChannels.stateChanged, state);
  };

  const onTimelineLog = (text: string) => {
    pushLog({ ts: Date.now(), dir: "info", text });
  };

  const onCaptureStateChanged = (status: CaptureStatus) => {
    getWindow()?.webContents.send(CaptureChannels.stateChanged, status);
  };

  device.on("log", pushLog);
  device.on("stateChanged", onStateChanged);
  hub.on("stateChanged", onHubStateChanged);
  amiibo.on("progress", onAmiiboProgress);
  amiibo.on("capabilitiesChanged", onAmiiboCapabilitiesChanged);
  const offRecorderStateChanged = recorder.onStateChanged(onRecorderStateChanged);
  timeline.on("time", onTimelineTime);
  timeline.on("state", onTimelineStateChanged);
  timeline.on("log", onTimelineLog);
  capture.on("stateChanged", onCaptureStateChanged);
  capture.on("log", pushLog);

  ipcMain.handle(DeviceChannels.listPorts, () => listSerialPorts());
  ipcMain.handle(
    DeviceChannels.connect,
    (_e, path: string, baud?: number) => device.connect(path, baud),
  );
  ipcMain.handle(DeviceChannels.disconnect, () => device.disconnect());
  ipcMain.handle(DeviceChannels.getStatus, () => device.getStatus());
  ipcMain.handle(DeviceChannels.sendNeutral, () => device.sendNeutral());
  ipcMain.handle(DeviceChannels.sendReport, (_e, report: PadReport) =>
    device.sendReport(report),
  );
  ipcMain.handle(HubChannels.setSource, (_e, source: HubSource) =>
    hub.setSource(source),
  );
  ipcMain.handle(HubChannels.getState, () => hub.getState());
  ipcMain.handle(HubChannels.forceNeutral, () => hub.forceNeutral());
  ipcMain.handle(PadChannels.apply, (_e, report: PadReport) =>
    hub.applyFrom("manual", report),
  );
  ipcMain.handle(PadChannels.reset, () => hub.forceNeutral());
  ipcMain.handle(LogChannels.subscribe, () => [...logBuffer]);
  ipcMain.handle(SettingsChannels.get, () => settings.get());
  ipcMain.handle(SettingsChannels.update, (_e, patch: object) =>
    settings.update(patch as Parameters<SettingsStore["update"]>[0]),
  );
  ipcMain.handle(ConfigChannels.get, () => config.get());
  ipcMain.handle(ConfigChannels.update, (_e, patch: object) =>
    config.update(patch as DeepPartialAppConfig),
  );
  ipcMain.handle(AppInfoChannels.get, () => ({
    name: app.getName(),
    version: app.getVersion(),
  }));
  ipcMain.handle(LogChannels.reportError, (_e, message: string) => {
    logger.crash("renderer", message);
  });
  ipcMain.handle(ProjectChannels.open, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "打开时间轴工程",
          filters: [
            { name: "NS2 时间轴工程", extensions: ["json"] },
            { name: "所有文件", extensions: ["*"] },
          ],
          properties: ["openFile"],
        })
      : await dialog.showOpenDialog({
          title: "打开时间轴工程",
          filters: [
            { name: "NS2 时间轴工程", extensions: ["json"] },
            { name: "所有文件", extensions: ["*"] },
          ],
          properties: ["openFile"],
        });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { ok: false, canceled: true };
    try {
      const content = await readFile(path, "utf-8");
      return { ok: true, path, content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(
    ProjectChannels.save,
    async (event, path: string | null, content: string, defaultName: string) => {
      let target = path;
      if (!target) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
        const result = win
          ? await dialog.showSaveDialog(win, {
              title: "保存时间轴工程",
              defaultPath: defaultName,
              filters: [
                { name: "NS2 时间轴工程", extensions: ["json"] },
                { name: "所有文件", extensions: ["*"] },
              ],
            })
          : await dialog.showSaveDialog({
              title: "保存时间轴工程",
              defaultPath: defaultName,
              filters: [
                { name: "NS2 时间轴工程", extensions: ["json"] },
                { name: "所有文件", extensions: ["*"] },
              ],
            });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }
        target = result.filePath;
      }
      try {
        await writeFile(target, content, "utf-8");
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(RecorderChannels.start, (_e, source: RecordingSource) => {
    recorder.start(source);
    return recorder.getState();
  });
  ipcMain.handle(RecorderChannels.stop, async () => {
    const rec = await recorder.stop();
    if (!rec) return { ok: false, error: "当前未在录制" };
    return { ok: true, content: serializeRecording(rec) };
  });
  ipcMain.handle(RecorderChannels.reset, () => {
    recorder.reset();
  });
  ipcMain.handle(RecorderChannels.getState, () => recorder.getState());
  ipcMain.handle(RecorderChannels.open, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "打开录制文件",
      filters: [
        { name: "NS2 录制 (.nsrec.json)", extensions: ["json"] },
        { name: "所有文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (result.canceled || !path) return { ok: false, canceled: true };
    try {
      const content = await readFile(path, "utf-8");
      return { ok: true, path, content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle(
    RecorderChannels.save,
    async (event, path: string | null, content: string, defaultName: string) => {
      let target = path;
      if (!target) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
        const options: Electron.SaveDialogOptions = {
          title: "保存录制文件",
          defaultPath: defaultName,
          filters: [
            { name: "NS2 录制 (.nsrec.json)", extensions: ["json"] },
            { name: "所有文件", extensions: ["*"] },
          ],
        };
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }
        target = result.filePath;
      }
      try {
        await writeFile(target, content, "utf-8");
        return { ok: true, path: target };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(AmiiboChannels.list, () => amiibo.listItems());
  ipcMain.handle(AmiiboChannels.pickAndImport, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "导入 Amiibo dump",
      filters: [
        { name: "Amiibo dump", extensions: ["bin"] },
        { name: "所有文件", extensions: ["*"] },
      ],
      properties: ["openFile"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return amiibo.importFile(path);
  });
  ipcMain.handle(AmiiboChannels.rename, (_e, id: string, name: string) =>
    amiibo.renameItem(id, name),
  );
  ipcMain.handle(AmiiboChannels.remove, (_e, id: string) =>
    amiibo.removeItem(id),
  );
  ipcMain.handle(AmiiboChannels.capabilities, () => amiibo.getCapabilities());
  ipcMain.handle(AmiiboChannels.saveToSlot, (_e, slot: number, id: string) =>
    amiibo.saveToSlot(slot, id),
  );
  ipcMain.handle(AmiiboChannels.changeIndex, (_e, slot: number) =>
    amiibo.changeIndex(slot),
  );
  ipcMain.handle(AmiiboChannels.cancel, () => amiibo.cancelSave());

  ipcMain.handle(TimelineChannels.load, (_e, input: unknown, opts?: { hz?: number }) =>
    timeline.load(input as Project | CompileResult, opts),
  );
  ipcMain.handle(TimelineChannels.play, (_e, opts?: { dryRun?: boolean }) =>
    timeline.play(opts),
  );
  ipcMain.handle(TimelineChannels.pause, () => timeline.pause());
  ipcMain.handle(TimelineChannels.stop, () => timeline.stop());
  ipcMain.handle(TimelineChannels.seek, (_e, ms: number) => timeline.seek(ms));

  ipcMain.handle(CaptureChannels.list, () => capture.list());
  ipcMain.handle(
    CaptureChannels.start,
    (_e, path?: string): Promise<CaptureStartResult> => capture.start(path),
  );
  ipcMain.handle(CaptureChannels.stop, () => capture.stop());
  ipcMain.handle(CaptureChannels.getStatus, () => capture.getStatus());

  return () => {
    device.off("log", pushLog);
    device.off("stateChanged", onStateChanged);
    hub.off("stateChanged", onHubStateChanged);
    amiibo.off("progress", onAmiiboProgress);
    amiibo.off("capabilitiesChanged", onAmiiboCapabilitiesChanged);
    offRecorderStateChanged();
    timeline.off("time", onTimelineTime);
    timeline.off("state", onTimelineStateChanged);
    timeline.off("log", onTimelineLog);
    capture.off("stateChanged", onCaptureStateChanged);
    capture.off("log", pushLog);
  };
}
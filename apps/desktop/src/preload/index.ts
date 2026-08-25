import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { PadReport } from "@ns2-studio/pad-types";
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
} from "../shared/channels";
import type {
  AmiiboCapabilities,
  AmiiboProgress,
  AppConfig,
  AppInfo,
  AppSettings,
  CaptureDeviceInfo,
  CaptureStartResult,
  CaptureStatus,
  DeepPartialAppConfig,
  DeviceStatus,
  HubSource,
  HubState,
  LogLine,
  ProjectOpenResult,
  ProjectSaveResult,
  RecorderState,
  RendererApi,
  TimelineLoadResult,
  TimelinePlayResult,
  TimelinePlaybackState,
} from "../shared/ipc";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: RendererApi = {
  device: {
    listPorts: () => ipcRenderer.invoke(DeviceChannels.listPorts),
    connect: (path: string, baud?: number) =>
      ipcRenderer.invoke(DeviceChannels.connect, path, baud),
    disconnect: () => ipcRenderer.invoke(DeviceChannels.disconnect),
    getStatus: () => ipcRenderer.invoke(DeviceChannels.getStatus),
    sendNeutral: () => ipcRenderer.invoke(DeviceChannels.sendNeutral),
    sendReport: (report: PadReport) =>
      ipcRenderer.invoke(DeviceChannels.sendReport, report),
    subscribeLog: () => ipcRenderer.invoke(LogChannels.subscribe),
    onStateChanged: (cb: (status: DeviceStatus) => void) =>
      subscribe<DeviceStatus>(DeviceChannels.stateChanged, cb),
    onLog: (cb: (line: LogLine) => void) =>
      subscribe<LogLine>(LogChannels.line, cb),
  },
  settings: {
    get: () => ipcRenderer.invoke(SettingsChannels.get),
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(SettingsChannels.update, patch),
  },
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke(ConfigChannels.get),
    update: (patch: DeepPartialAppConfig): Promise<AppConfig> =>
      ipcRenderer.invoke(ConfigChannels.update, patch),
  },
  appInfo: {
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(AppInfoChannels.get),
    reportError: (detail: string): Promise<void> =>
      ipcRenderer.invoke(LogChannels.reportError, detail),
  },
  hub: {
    setSource: (source: HubSource) =>
      ipcRenderer.invoke(HubChannels.setSource, source),
    getState: () => ipcRenderer.invoke(HubChannels.getState),
    forceNeutral: () => ipcRenderer.invoke(HubChannels.forceNeutral),
    onStateChanged: (cb: (state: HubState) => void) =>
      subscribe<HubState>(HubChannels.stateChanged, cb),
  },
  pad: {
    apply: (report: PadReport) =>
      ipcRenderer.invoke(PadChannels.apply, report),
    reset: () => ipcRenderer.invoke(PadChannels.reset),
  },
  project: {
    open: (): Promise<ProjectOpenResult> => ipcRenderer.invoke(ProjectChannels.open),
    save: (path: string | null, content: string, defaultName: string): Promise<ProjectSaveResult> =>
      ipcRenderer.invoke(ProjectChannels.save, path, content, defaultName),
  },
  recorder: {
    start: (source: RecordingSource): Promise<RecorderState> =>
      ipcRenderer.invoke(RecorderChannels.start, source),
    stop: () => ipcRenderer.invoke(RecorderChannels.stop),
    reset: () => ipcRenderer.invoke(RecorderChannels.reset),
    getState: (): Promise<RecorderState> => ipcRenderer.invoke(RecorderChannels.getState),
    onStateChanged: (cb: (state: RecorderState) => void) =>
      subscribe<RecorderState>(RecorderChannels.stateChanged, cb),
    open: (): Promise<ProjectOpenResult> => ipcRenderer.invoke(RecorderChannels.open),
    save: (path: string | null, content: string, defaultName: string): Promise<ProjectSaveResult> =>
      ipcRenderer.invoke(RecorderChannels.save, path, content, defaultName),
  },
  timeline: {
    load: (input: unknown, opts?: { hz?: number }): Promise<TimelineLoadResult> =>
      ipcRenderer.invoke(TimelineChannels.load, input, opts),
    play: (opts?: { dryRun?: boolean }): Promise<TimelinePlayResult> =>
      ipcRenderer.invoke(TimelineChannels.play, opts),
    pause: (): Promise<TimelinePlaybackState> =>
      ipcRenderer.invoke(TimelineChannels.pause),
    stop: (): Promise<TimelinePlaybackState> =>
      ipcRenderer.invoke(TimelineChannels.stop),
    seek: (ms: number): Promise<TimelinePlaybackState> =>
      ipcRenderer.invoke(TimelineChannels.seek, ms),
    onTime: (cb: (ms: number) => void) =>
      subscribe<number>(TimelineChannels.playbackTime, cb),
    onState: (cb: (state: TimelinePlaybackState) => void) =>
      subscribe<TimelinePlaybackState>(TimelineChannels.stateChanged, cb),
  },
  amiibo: {
    list: () => ipcRenderer.invoke(AmiiboChannels.list),
    pickAndImport: () => ipcRenderer.invoke(AmiiboChannels.pickAndImport),
    rename: (id: string, name: string) =>
      ipcRenderer.invoke(AmiiboChannels.rename, id, name),
    remove: (id: string) => ipcRenderer.invoke(AmiiboChannels.remove, id),
    getCapabilities: () => ipcRenderer.invoke(AmiiboChannels.capabilities),
    saveToSlot: (slot: number, id: string) =>
      ipcRenderer.invoke(AmiiboChannels.saveToSlot, slot, id),
    changeIndex: (slot: number) =>
      ipcRenderer.invoke(AmiiboChannels.changeIndex, slot),
    cancel: () => ipcRenderer.invoke(AmiiboChannels.cancel),
    onProgress: (cb: (p: AmiiboProgress) => void) =>
      subscribe<AmiiboProgress>(AmiiboChannels.progress, cb),
    onCapabilitiesChanged: (cb: (c: AmiiboCapabilities) => void) =>
      subscribe<AmiiboCapabilities>(AmiiboChannels.capabilitiesChanged, cb),
  },
  capture: {
    list: (): Promise<CaptureDeviceInfo[]> =>
      ipcRenderer.invoke(CaptureChannels.list),
    start: (path?: string): Promise<CaptureStartResult> =>
      ipcRenderer.invoke(CaptureChannels.start, path),
    stop: (): Promise<void> => ipcRenderer.invoke(CaptureChannels.stop),
    getStatus: (): Promise<CaptureStatus> =>
      ipcRenderer.invoke(CaptureChannels.getStatus),
    onStateChanged: (cb: (status: CaptureStatus) => void) =>
      subscribe<CaptureStatus>(CaptureChannels.stateChanged, cb),
  },
};

contextBridge.exposeInMainWorld("api", api);
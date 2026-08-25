import { buildInitCommands, parseNs2ProReport } from "./ns2-pro-parser";
import type { Ns2ProParserOptions } from "./ns2-pro-parser";
import type { HidDeviceInfo, HidDeviceLike } from "./types";
import {
  getHidLoadError,
  sendInitViaOutputReport,
} from "./node-hid-layer";
import {
  listNs2ProDevices,
  openNs2ProDevice,
} from "./hid-factory";
import type {
  CaptureStartResult,
  CaptureStatus,
  LogDirection,
  LogLine,
} from "../../shared/ipc";
import type { InputHub } from "../hub/input-hub";

type EventMap = Record<string, (...args: never[]) => void>;

class TypedEmitter<E extends EventMap> {
  private listeners: { [K in keyof E]?: Set<E[K]> } = {};

  on<K extends keyof E>(event: K, cb: E[K]): () => void {
    (this.listeners[event] ??= new Set()).add(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof E>(event: K, cb: E[K]): void {
    this.listeners[event]?.delete(cb);
  }

  protected emit<K extends keyof E>(event: K, ...args: Parameters<E[K]>): void {
    this.listeners[event]?.forEach((cb) => cb(...args));
  }
}

export type CaptureServiceEvents = {
  stateChanged: (status: CaptureStatus) => void;
  log: (line: LogLine) => void;
};

export interface CaptureServiceOptions {
  /** Enumerate NS2 Pro devices (injectable for tests). */
  listDevices?: () => Promise<HidDeviceInfo[]>;
  /** Open one device by info (injectable for tests). */
  openDevice?: (info: HidDeviceInfo) => Promise<HidDeviceLike>;
  /** node-hid load error, if any (graceful degradation). */
  getLoadError?: () => string | undefined;
  /** Read timeout for one HID read; 4ms targets the 250Hz endpoint. */
  readTimeoutMs?: number;
  /** Delay between init command writes (procon2 uses 15ms). */
  initIntervalMs?: number;
  /** Init command frames (lab-note §7.1 minimal set by default). */
  initCommands?: () => Uint8Array[];
  parserOptions?: Ns2ProParserOptions;
}

const DEFAULT_READ_TIMEOUT_MS = 4;
const DEFAULT_INIT_INTERVAL_MS = 15;

/**
 * Captures a wired NS2 Pro over node-hid and forwards parsed reports through
 * the InputHub `forward` source (S8). Owns the HID lifecycle in the main
 * process: enumerate -> open -> best-effort init -> streaming read loop ->
 * hub.applyFrom("forward", report). On stop/unplug it releases the source and
 * neutralizes (via hub.setSource("idle"), which sends NEUTRAL first).
 *
 * Any report that is not a supported 0x09 frame moves to "unsupported" and
 * nothing is emitted ("不得乱发"). node-hid load failure degrades to
 * "capture unavailable" instead of crashing the app.
 */
export class CaptureService extends TypedEmitter<CaptureServiceEvents> {
  private state: CaptureStatus["state"] = "idle";
  private info?: HidDeviceInfo;
  private initMode: "output-report" | "listen-only" = "listen-only";
  private errorText?: string;
  private loadErrorText?: string;

  private device: HidDeviceLike | null = null;
  private intentionalClose = false;
  private closing = false;

  private readonly listDevices: () => Promise<HidDeviceInfo[]>;
  private readonly openDevice: (info: HidDeviceInfo) => Promise<HidDeviceLike>;
  private readonly getLoadError: () => string | undefined;
  private readonly readTimeoutMs: number;
  private readonly initIntervalMs: number;
  private readonly initCommands: () => Uint8Array[];
  private readonly parserOptions: Ns2ProParserOptions;

  constructor(private readonly hub: InputHub, opts: CaptureServiceOptions = {}) {
    super();
    this.listDevices = opts.listDevices ?? listNs2ProDevices;
    this.openDevice = opts.openDevice ?? openNs2ProDevice;
    this.getLoadError = opts.getLoadError ?? getHidLoadError;
    this.readTimeoutMs = opts.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    this.initIntervalMs = opts.initIntervalMs ?? DEFAULT_INIT_INTERVAL_MS;
    this.initCommands = opts.initCommands ?? buildInitCommands;
    this.parserOptions = opts.parserOptions ?? {};
    this.loadErrorText = this.getLoadError();
  }

  getStatus(): CaptureStatus {
    return {
      state: this.state,
      device: this.info,
      initMode: this.initMode,
      error: this.errorText,
      loadError: this.loadErrorText,
    };
  }

  /**
   * Enumerate visible wired NS2 Pro devices. Never throws: node-hid load
   * failures are surfaced through `getStatus().loadError`.
   */
  async list(): Promise<HidDeviceInfo[]> {
    const loadErr = this.getLoadError();
    if (loadErr) {
      this.loadErrorText = loadErr;
      return [];
    }
    try {
      const devs = await this.listDevices();
      this.loadErrorText = undefined;
      return devs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.loadErrorText = message;
      return [];
    }
  }

  async start(path?: string): Promise<CaptureStartResult> {
    if (this.state === "connecting" || this.state === "streaming") {
      return { ok: false, error: "busy: capture already running" };
    }
    const loadErr = this.getLoadError();
    if (loadErr) {
      this.loadErrorText = loadErr;
      return { ok: false, error: `node-hid 不可用：${loadErr}` };
    }

    let devices: HidDeviceInfo[];
    try {
      devices = await this.listDevices();
      this.loadErrorText = undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.loadErrorText = message;
      return { ok: false, error: `node-hid 枚举失败：${message}` };
    }
    if (devices.length === 0) {
      this.setState("error", {
        error: "未发现 NS2 Pro（有线 0x057E:0x2069，安全模式 0x2072 排除）",
      });
      return { ok: false, error: this.getStatus().error };
    }

    const info = devices.find((d) => d.path === path) ?? (devices[0] as HidDeviceInfo);
    this.intentionalClose = false;
    this.closing = false;
    this.info = info;
    this.setState("connecting", { device: info });

    try {
      const dev = await this.openDevice(info);
      this.device = dev;
      dev.onClose(() => void this.handleDeviceClose());
      dev.onError((err) => this.log("error", `hid: ${err.message}`));
      await dev.open();

      let initMode: "output-report" | "listen-only" = "listen-only";
      const commands = this.initCommands();
      if (commands.length > 0) {
        const res = await sendInitViaOutputReport(dev, commands, this.initIntervalMs);
        if (res.failed) {
          // Transport unverified (lab-note §10 #1): log detail, listen only.
          this.log(
            "warn",
            `init 经 HID output report 发送失败，进入只监听默认报告模式：${res.failed}`,
          );
        } else {
          initMode = "output-report";
          this.log(
            "info",
            `init 已发送 ${res.sent}/${commands.length} 条命令（output report）`,
          );
        }
      }
      this.initMode = initMode;

      await this.hub.setSource("forward");
      this.setState("streaming", { device: info });
      this.log(
        "info",
        `采集启动：${info.path}（${info.product ?? "NS2 Pro"}，init=${initMode}）`,
      );
      void this.readLoop();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `采集启动失败：${message}`);
      await this.teardown();
      this.setState("error", { error: message });
      return { ok: false, error: message };
    }
  }

  async stop(): Promise<void> {
    this.intentionalClose = true;
    this.closing = false;
    const wasActive = this.state === "connecting" || this.state === "streaming";
    if (wasActive) await this.releaseForward();
    await this.teardown();
    this.setState("idle");
    this.log("info", "采集已停止");
  }

  /** App-quit hook: close the HID device, fire-and-forget. */
  dispose(): void {
    this.intentionalClose = true;
    void this.teardown();
  }

  // ------------------------------------------------------------------
  // Read loop / handling
  // ------------------------------------------------------------------

  private async readLoop(): Promise<void> {
    const dev = this.device;
    if (!dev) return;
    let uncalibratedLogged = false;
    while (this.state === "streaming" && this.device === dev) {
      let frame: Uint8Array | null;
      try {
        frame = await dev.read(this.readTimeoutMs);
      } catch {
        // Unplug/read failure: NodeHidLayer already fired onClose, which
        // routes to handleDeviceClose -> idle. Just stop the loop here.
        break;
      }
      if (!frame || frame.length === 0) continue;

      const parsed = parseNs2ProReport(frame, this.parserOptions);
      if (!parsed) {
        await this.failUnsupported(
          `不支持的报告格式（len=${frame.length}，首字节 0x${(frame[0] ?? 0)
            .toString(16)
            .padStart(2, "0")}），停止采集`,
        );
        break;
      }
      if (!parsed.calibrated && !uncalibratedLogged) {
        uncalibratedLogged = true;
        this.log(
          "warn",
          "无校准数据，摇杆使用原始值线性映射（实机后建议写入校准/死区）",
        );
      }
      try {
        await this.hub.applyFrom("forward", parsed.report);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log("warn", `report 下发失败：${message}`);
      }
    }
  }

  private async failUnsupported(reason: string): Promise<void> {
    this.log("warn", reason);
    this.intentionalClose = true;
    await this.releaseForward();
    await this.teardown();
    this.setState("unsupported", { error: reason });
  }

  private handleDeviceClose(): void {
    if (this.intentionalClose || this.closing) return;
    if (this.state !== "streaming" && this.state !== "connecting") return;
    this.closing = true;
    this.log("warn", "NS2 Pro 已断开，停止转发");
    void (async () => {
      try {
        await this.releaseForward();
      } finally {
        this.closing = false;
        this.setState("idle");
        this.log("info", "采集设备断开，已回到 idle");
      }
    })();
  }

  /** Release the forward source (neutralizes via hub.setSource). */
  private async releaseForward(): Promise<void> {
    if (this.hub.getState().activeSource === "forward") {
      await this.hub.setSource("idle");
    }
  }

  private async teardown(): Promise<void> {
    const dev = this.device;
    this.device = null;
    if (dev && dev.isOpen) {
      try {
        await dev.close();
      } catch {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------------
  // State / logging
  // ------------------------------------------------------------------

  private setState(
    state: CaptureStatus["state"],
    patch?: { device?: HidDeviceInfo; error?: string },
  ): void {
    this.state = state;
    if (patch?.device !== undefined) this.info = patch.device;
    if (state === "idle" || state === "streaming") this.errorText = undefined;
    if (patch?.error !== undefined) this.errorText = patch.error;
    this.emit("stateChanged", this.getStatus());
  }

  private log(dir: LogDirection, text: string, hex?: string): void {
    this.emit("log", { ts: Date.now(), dir, text, hex });
  }
}
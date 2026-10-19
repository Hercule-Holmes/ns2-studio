import {
  EzDvCommand,
  Reply,
  commands,
  decodeReportPacket,
} from "@ns2-studio/protocol";
import { NEUTRAL_REPORT } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";
import type {
  ConnectResult,
  DeviceState,
  DeviceStatus,
  LogDirection,
  LogLine,
  WakeResult,
} from "../../shared/ipc";
import { ReportWriter } from "./report-writer";
import type { SerialPortLike } from "./types";

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

export type DeviceServiceEvents = {
  stateChanged: (status: DeviceStatus) => void;
  log: (line: LogLine) => void;
};

export interface DeviceServiceOptions {
  minIntervalMs?: number;
  handshakeTimeoutMs?: number;
  versionTimeoutMs?: number;
  requestVersion?: boolean;
  hexLog?: boolean;
  layerFactory: (path: string, baudRate: number) => Promise<SerialPortLike>;
}

const VERSION_FRAME = Uint8Array.from([EzDvCommand.Ready, EzDvCommand.Version]);
const WAKE_FRAME = Uint8Array.from([EzDvCommand.Ready, EzDvCommand.Wake]);

function formatReport(report: PadReport): string {
  return `report buttons=0x${report.buttons.toString(16)} hat=${report.hat} lx=${report.lx} ly=${report.ly} rx=${report.rx} ry=${report.ry}`;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

/**
 * Owns the serial lifecycle in the main process:
 * open -> Hello -> (Version) -> Connected, plus a coalescing write queue
 * and RX report decoding. Emits state/log events for the renderer.
 */
export class DeviceService extends TypedEmitter<DeviceServiceEvents> {
  private layer: SerialPortLike | null = null;
  private writer: ReportWriter | null = null;
  private rxListeners = new Set<(data: Uint8Array) => void>();
  private rxBuffer: number[] = [];

  private state: DeviceState = "disconnected";
  private path?: string;
  private baud?: number;
  private version?: string;
  private error?: string;

  private readonly minIntervalMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly versionTimeoutMs: number;
  private readonly requestVersion: boolean;
  private readonly hexLog: boolean;
  private intentionalClose = false;

  constructor(private opts: DeviceServiceOptions) {
    super();
    this.minIntervalMs = opts.minIntervalMs ?? 2;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 2000;
    this.versionTimeoutMs = opts.versionTimeoutMs ?? 500;
    this.requestVersion = opts.requestVersion ?? true;
    this.hexLog = opts.hexLog ?? false;
  }

  getStatus(): DeviceStatus {
    return {
      state: this.state,
      path: this.path,
      baud: this.baud,
      version: this.version,
      error: this.error,
    };
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }

  /**
   * Enqueue a raw command frame (FIFO, never coalesced) and wait until it has
   * been written to the wire. Used by protocol-level ops (Amiibo save etc.)
   * that must own their own ACK/retry flow.
   */
  async writeCommand(bytes: Uint8Array): Promise<void> {
    this.writer?.enqueueCommand(bytes);
    await this.writer?.flush();
  }

  /**
   * Subscribe to raw RX bytes from the device (before report decoding).
   * Returns an unsubscribe function. Used for ACK/Hello/Version replies that
   * are not 8-byte report frames.
   */
  onRxData(cb: (data: Uint8Array) => void): () => void {
    return this.onRx(cb);
  }

  async connect(path: string, baud = 115200): Promise<ConnectResult> {
    this.intentionalClose = false;
    if (this.state === "connected" && this.path === path) {
      return { ok: true, version: this.version };
    }
    if (this.state === "connecting" || this.state === "handshaking") {
      return { ok: false, error: "busy: already connecting" };
    }
    if (this.state === "connected") {
      await this.disconnect();
    }

    this.setState("connecting", { path, baud });
    try {
      const layer = await this.opts.layerFactory(path, baud);
      this.layer = layer;
      layer.onData((data) => this.handleData(data));
      layer.onError((err) => this.handleError(err));
      layer.onClose(() => this.handleClose());
      await layer.open();
      this.log("info", `port opened: ${path} @ ${baud}`);

      this.writer = new ReportWriter(layer, this.minIntervalMs, (bytes) =>
        this.logBytes("tx", bytes),
      );

      this.setState("handshaking", { path, baud });
      const helloOk = await this.sendHelloAndWaitAck();
      if (!helloOk) {
        throw new Error("hello 握手超时/无回应 (expected 0x80)");
      }

      const version = this.requestVersion
        ? await this.fetchVersion()
        : undefined;

      this.path = path;
      this.baud = baud;
      this.version = version;
      this.setState("connected", { path, baud, version });
      this.log("info", version ? `connected (version ${version})` : "connected");
      return { ok: true, version };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log("error", `connect failed: ${message}`);
      await this.teardown();
      this.setState("error", { path, baud, error: message });
      return { ok: false, error: message };
    }
  }

  async disconnect(): Promise<void> {
    if (this.state === "disconnected") return;
    this.intentionalClose = true;
    try {
      if (this.writer && this.layer?.isOpen) {
        this.writer.enqueueReport(NEUTRAL_REPORT);
        await this.writer.flush();
      }
    } finally {
      await this.teardown();
      this.setState("disconnected");
    }
  }

  async sendNeutral(): Promise<void> {
    this.writer?.enqueueReport(NEUTRAL_REPORT);
    await this.writer?.flush();
  }

  async sendReport(report: PadReport): Promise<void> {
    this.writer?.enqueueReport(report);
    await this.writer?.flush();
  }

  /**
   * Ask the MCU to wake a sleeping Switch (CMD_WAKE 0x92, 02-PROTOCOL.md
   * §3.4). The replug path (sleep-detached dock port) can take ~3.5s, so
   * the wait window is generous; one retry on timeout. Ack covers "already
   * awake" and "woken" — both map to ok.
   */
  async wake(timeoutMs = 6000, retries = 1): Promise<WakeResult> {
    if (!this.isConnected || !this.writer) {
      return {
        ok: false,
        code: "not-connected",
        message: "设备未连接，无法发送唤醒命令",
      };
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await this.wakeOnce(timeoutMs);
      if (result.ok || result.code !== "timeout") return result;
      this.log("warn", `wake timeout (attempt ${attempt + 1}), retrying`);
    }
    return {
      ok: false,
      code: "timeout",
      message: "唤醒命令无响应（超时）",
    };
  }

  private wakeOnce(timeoutMs: number): Promise<WakeResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, code: "timeout" });
      }, timeoutMs);
      const onData = (data: Uint8Array) => {
        // Reply is a lone 0xFF (ok), or 0x00 optionally followed by a
        // 1-byte reason code (firmware WAKE_ERR_*). Multi-byte report
        // traffic can embed both values, so only accept short chunks.
        if (data.length === 1 && data[0] === Reply.Ack) {
          cleanup();
          this.log("info", "wake ack");
          resolve({
            ok: true,
            code: "ok",
            message: "主机已唤醒（或本就未休眠）",
          });
          return;
        }
        if (
          (data.length === 1 || data.length === 2) &&
          data[0] === Reply.Error
        ) {
          cleanup();
          this.log("warn", `wake error reply${data[1] !== undefined ? ` (reason 0x${data[1].toString(16)})` : ""}`);
          resolve({
            ok: false,
            code: "error",
            message:
              "唤醒失败：主机未启用有线唤醒，或固件未实现 CMD_WAKE 0x92",
          });
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.offRx(onData);
      };
      this.onRx(onData);
      this.writer?.enqueueCommand(WAKE_FRAME);
    });
  }

  /** App-quit hook: neutral + close, fire-and-forget. */
  shutdown(): void {
    void (async () => {
      this.intentionalClose = true;
      try {
        if (this.writer && this.layer?.isOpen) {
          this.writer.enqueueReport(NEUTRAL_REPORT);
          await this.writer.flush();
        }
        await this.teardown();
        this.setState("disconnected");
      } catch {
        /* best-effort on quit */
      }
    })();
  }

  // ------------------------------------------------------------------
  // Handshake internals
  // ------------------------------------------------------------------

  private sendHelloAndWaitAck(): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, this.handshakeTimeoutMs);
      const onData = (data: Uint8Array) => {
        if (Array.from(data).includes(Reply.Hello)) {
          cleanup();
          this.log("rx", "hello ack 0x80");
          resolve(true);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.offRx(onData);
      };
      this.onRx(onData);
      this.writer?.enqueueCommand(commands.hello());
    });
  }

  private fetchVersion(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const collected: number[] = [];
      let lastActivity = Date.now();
      const finish = () => {
        const text = String.fromCharCode(...collected)
          .replace(/[^\x20-\x7e]/g, "")
          .trim();
        resolve(text.length > 0 ? text : undefined);
      };
      const timer = setTimeout(() => {
        cleanup();
        finish();
      }, this.versionTimeoutMs);
      const settleTimer = setInterval(() => {
        if (Date.now() - lastActivity >= 80) {
          cleanup();
          finish();
        }
      }, 40);
      const onData = (data: Uint8Array) => {
        collected.push(...data);
        lastActivity = Date.now();
      };
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(settleTimer);
        this.offRx(onData);
      };
      this.onRx(onData);
      this.writer?.enqueueCommand(VERSION_FRAME);
    });
  }

  // ------------------------------------------------------------------
  // RX handling
  // ------------------------------------------------------------------

  private onRx(cb: (data: Uint8Array) => void): () => void {
    this.rxListeners.add(cb);
    return () => this.rxListeners.delete(cb);
  }

  private offRx(cb: (data: Uint8Array) => void): void {
    this.rxListeners.delete(cb);
  }

  private handleData(data: Uint8Array): void {
    this.logBytes("rx", data);
    for (const cb of [...this.rxListeners]) cb(data);
    if (this.state === "connected") this.tryDecodeReports(data);
  }

  private tryDecodeReports(chunk: Uint8Array): void {
    this.rxBuffer.push(...chunk);
    while (this.rxBuffer.length >= 8) {
      const slice = this.rxBuffer.slice(0, 8);
      const decoded = decodeReportPacket(Uint8Array.from(slice));
      if (decoded) {
        this.rxBuffer.splice(0, 8);
        this.log("rx", formatReport(decoded.report));
      } else {
        this.rxBuffer.shift();
      }
    }
  }

  private handleError(err: Error): void {
    this.log("error", `serial error: ${err.message}`);
    if (
      this.state === "connecting" ||
      this.state === "handshaking" ||
      this.state === "connected"
    ) {
      this.setState("error", {
        path: this.path,
        baud: this.baud,
        error: err.message,
      });
    }
  }

  private handleClose(): void {
    if (this.intentionalClose) {
      this.intentionalClose = false;
      return;
    }
    if (this.state === "disconnected") return;
    this.log("warn", "serial port closed unexpectedly");
    this.setState("disconnected");
  }

  // ------------------------------------------------------------------
  // State / teardown
  // ------------------------------------------------------------------

  private async teardown(): Promise<void> {
    this.writer?.close();
    this.writer = null;
    const layer = this.layer;
    this.layer = null;
    if (layer?.isOpen) {
      try {
        await layer.close();
      } catch {
        /* ignore */
      }
    }
  }

  private setState(
    state: DeviceState,
    patch?: {
      path?: string;
      baud?: number;
      version?: string;
      error?: string;
    },
  ): void {
    this.state = state;
    if (patch?.path !== undefined) this.path = patch.path;
    if (patch?.baud !== undefined) this.baud = patch.baud;
    if (patch?.version !== undefined) this.version = patch.version;
    if (state === "disconnected") this.error = undefined;
    if (patch?.error !== undefined) this.error = patch.error;
    this.emit("stateChanged", this.getStatus());
  }

  private log(dir: LogDirection, text: string, hex?: string): void {
    this.emit("log", { ts: Date.now(), dir, text, hex });
  }

  private logBytes(dir: "tx" | "rx", bytes: Uint8Array): void {
    this.log(
      dir,
      `${dir === "tx" ? "TX" : "RX"} ${bytes.length}B`,
      this.hexLog ? toHex(bytes) : undefined,
    );
  }
}
import type { HidDeviceInfo, HidDeviceLike } from "./types";

/**
 * Lazy node-hid loader. `node-hid` is a native module (Electron ABI-sensitive)
 * and is only touched when capture actually starts. Any load failure is cached
 * and surfaced as a friendly error so the app degrades to "capture unavailable"
 * instead of crashing at startup.
 */
type NodeHidModule = typeof import("node-hid");

let hidModule: NodeHidModule | null = null;
let hidLoadError: string | undefined;

export function getHidLoadError(): string | undefined {
  return hidLoadError;
}

export async function loadNodeHid(): Promise<NodeHidModule> {
  if (hidModule) return hidModule;
  if (hidLoadError) throw new Error(hidLoadError);
  try {
    hidModule = await import("node-hid");
    return hidModule;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hidLoadError = `node-hid 加载失败（native 模块可能未正确构建/ABI 不匹配）: ${message}`;
    throw new Error(hidLoadError);
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps a node-hid `HIDAsync` device behind `HidDeviceLike`. Uses the explicit
 * read(timeout) loop (no "data" event) so the read loop can throttle and the
 * close path is deterministic.
 */
export class NodeHidLayer implements HidDeviceLike {
  private readonly dev: import("node-hid").HIDAsync;
  private closed = false;
  private closeListeners: Array<() => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];

  private constructor(info: HidDeviceInfo, dev: import("node-hid").HIDAsync) {
    this.info = info;
    this.dev = dev;
    dev.on("error", (err: Error) => this.notifyClosed(err));
  }

  readonly info: HidDeviceInfo;

  get isOpen(): boolean {
    return !this.closed;
  }

  static async open(info: HidDeviceInfo): Promise<NodeHidLayer> {
    const hid = await loadNodeHid();
    const dev = await hid.HIDAsync.open(info.path);
    return new NodeHidLayer(info, dev);
  }

  async open(): Promise<void> {
    // node-hid HIDAsync is open once constructed; nothing extra to do.
    this.closed = false;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error("HID device closed");
    // Output reports on the NS2 Pro use report ID 0x02 (lab-note §2/§10 #1).
    await this.dev.write([0x02, ...data]);
  }

  async read(timeoutMs: number): Promise<Uint8Array | null> {
    if (this.closed) throw new Error("HID device closed");
    try {
      const data = await this.dev.read(timeoutMs);
      if (!data || data.length === 0) return null;
      return new Uint8Array(data);
    } catch (err) {
      // Unplug / read failure: notify close once, then rethrow.
      this.notifyClosed(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (err: Error) => void): void {
    this.errorListeners.push(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; // intentional close: suppress onClose
    await this.dev.close();
  }

  private notifyClosed(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.closeListeners) l();
    if (err) for (const l of this.errorListeners) l(err);
  }
}

/**
 * Shared small delay between init command writes (procon2 uses 15ms; keep it
 * small and configurable for tests).
 */
export const INIT_INTERVAL_MS = 15;

/** Send init commands over the HID output-report channel (lab-note §10 #1). */
export async function sendInitViaOutputReport(
  dev: HidDeviceLike,
  commands: Uint8Array[],
  intervalMs = INIT_INTERVAL_MS,
): Promise<{ sent: number; failed?: string }> {
  let sent = 0;
  for (const cmd of commands) {
    try {
      await dev.write(cmd);
      sent += 1;
      await delay(intervalMs);
    } catch (err) {
      return { sent, failed: err instanceof Error ? err.message : String(err) };
    }
  }
  return { sent };
}
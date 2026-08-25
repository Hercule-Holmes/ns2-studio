import type { DeviceService } from "../device/device-service";
import { AmiiboStore } from "./amiibo-store";
import { AmiiboDeviceApi } from "./device-api";
import { AmiiboError } from "./errors";
import type {
  AmiiboCapabilities,
  AmiiboItem,
  AmiiboProgress,
} from "../../shared/ipc";

type AmiiboCapability = "true" | "false" | "unknown";

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

export type AmiiboServiceEvents = {
  progress: (p: AmiiboProgress) => void;
  capabilitiesChanged: (c: AmiiboCapabilities) => void;
};

export type SaveSlotOutcome =
  | { ok: true; slot: number; sent: number; total: number }
  | { ok: false; code: string; message: string };

export type ChangeIndexOutcome =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * S9 façade over the amiibo library + protocol device ops. Owns the
 * `capabilities.amiibo` state machine:
 *
 *   - (re)connect -> "unknown"
 *   - successful save/change -> "true"
 *   - firmware replied Error (unsupported) -> "false"
 *
 * Progress and capability changes are emitted for the renderer to push over IPC.
 */
export class AmiiboService extends TypedEmitter<AmiiboServiceEvents> {
  private cap: AmiiboCapability = "unknown";
  private currentSave: AbortController | null = null;

  constructor(
    private readonly store: AmiiboStore,
    private readonly deviceApi: AmiiboDeviceApi,
    private readonly device: DeviceService,
  ) {
    super();
    this.device.on("stateChanged", (status) => {
      this.cap = "unknown";
      this.emit("capabilitiesChanged", this.getCapabilities());
      if (status.state !== "connected") {
        this.currentSave?.abort();
      }
    });
  }

  getCapabilities(): AmiiboCapabilities {
    return { amiibo: this.cap, connected: this.device.isConnected };
  }

  listItems(): Promise<AmiiboItem[]> {
    return this.store.list();
  }

  importFile(path: string, name?: string): Promise<AmiiboItem> {
    return this.store.importFile(path, name);
  }

  renameItem(id: string, name: string): Promise<AmiiboItem> {
    return this.store.rename(id, name);
  }

  removeItem(id: string): Promise<void> {
    return this.store.remove(id);
  }

  cancelSave(): void {
    this.currentSave?.abort();
  }

  async saveToSlot(slot: number, itemId: string): Promise<SaveSlotOutcome> {
    if (this.currentSave) {
      return {
        ok: false,
        code: "BUSY",
        message: "已有写入任务进行中，请先等待或取消",
      };
    }
    const controller = new AbortController();
    this.currentSave = controller;
    try {
      const bytes = await this.store.readBytes(itemId);
      const result = await this.deviceApi.saveToSlot(slot, bytes, {
        signal: controller.signal,
        onProgress: (p) => this.emit("progress", { slot: p.slot, sent: p.sent, total: p.total }),
      });
      this.cap = "true";
      await this.store.setLastSlot(itemId, slot);
      this.emit("capabilitiesChanged", this.getCapabilities());
      return { ok: true, slot: result.slot, sent: result.sent, total: result.total };
    } catch (err) {
      if (err instanceof AmiiboError) {
        if (err.kind === "UNSUPPORTED") {
          this.cap = "false";
          this.emit("capabilitiesChanged", this.getCapabilities());
        }
        return { ok: false, code: err.kind, message: err.message };
      }
      return {
        ok: false,
        code: "IO",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.currentSave = null;
    }
  }

  async changeIndex(slot: number): Promise<ChangeIndexOutcome> {
    try {
      await this.deviceApi.changeIndex(slot);
      this.cap = "true";
      this.emit("capabilitiesChanged", this.getCapabilities());
      return { ok: true };
    } catch (err) {
      if (err instanceof AmiiboError) {
        if (err.kind === "UNSUPPORTED") {
          this.cap = "false";
          this.emit("capabilitiesChanged", this.getCapabilities());
        }
        return { ok: false, code: err.kind, message: err.message };
      }
      return {
        ok: false,
        code: "IO",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
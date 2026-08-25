import { NEUTRAL_REPORT } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";
import type { DeviceService } from "../device/device-service";
import type { HubSource, HubState } from "../../shared/ipc";

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

export type InputHubEvents = {
  stateChanged: (state: HubState) => void;
  /**
   * Fired whenever a report is actually dispatched to the device (S7 recorder
   * hook). Added on the hub's write path without touching arbitration logic.
   */
  reportSent: (report: PadReport) => void;
};

const IDLE: HubSource = "idle";

/**
 * Output-source arbiter (01-SYSTEM-ARCHITECTURE.md §4). Exactly one source is
 * active at a time; switching always resets to NEUTRAL first so no stuck keys
 * survive a source change. The only path into DeviceService's report queue is
 * via `applyFrom`, which is gated on the caller being the active source.
 */
export class InputHub extends TypedEmitter<InputHubEvents> {
  private active: HubSource = IDLE;
  private offDeviceStateChanged: () => void;

  constructor(private device: DeviceService) {
    super();
    this.offDeviceStateChanged = device.on("stateChanged", (status) => {
      if (status.state !== "connected" && this.active !== IDLE) {
        this.active = IDLE;
        this.emit("stateChanged", this.getState());
      }
    });
  }

  getState(): HubState {
    return { activeSource: this.active };
  }

  async setSource(source: HubSource): Promise<HubState> {
    if (source === this.active) return this.getState();
    await this.device.sendReport(NEUTRAL_REPORT);
    this.emit("reportSent", NEUTRAL_REPORT);
    this.active = source;
    this.emit("stateChanged", this.getState());
    return this.getState();
  }

  async applyFrom(source: HubSource, report: PadReport): Promise<void> {
    if (source !== this.active) return;
    await this.device.sendReport(report);
    this.emit("reportSent", report);
  }

  async forceNeutral(): Promise<void> {
    await this.device.sendReport(NEUTRAL_REPORT);
    this.emit("reportSent", NEUTRAL_REPORT);
  }

  dispose(): void {
    this.offDeviceStateChanged();
  }
}
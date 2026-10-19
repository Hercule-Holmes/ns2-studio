import { NEUTRAL_REPORT } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";
import type { InputHub } from "../hub/input-hub";
import type { DeviceService } from "../device/device-service";
import type { ConfigStore } from "../config/config-store";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isNeutralReport(report: PadReport): boolean {
  return (
    report.buttons === NEUTRAL_REPORT.buttons &&
    report.hat === NEUTRAL_REPORT.hat &&
    report.lx === NEUTRAL_REPORT.lx &&
    report.ly === NEUTRAL_REPORT.ly &&
    report.rx === NEUTRAL_REPORT.rx &&
    report.ry === NEUTRAL_REPORT.ry
  );
}

/**
 * Wake-research fallback B3: while a phone remote session is active, NS
 * auto-sleep would strand the session. Field tests (2026-10-19, S0 §3.5)
 * proved USB wired wake impossible on the dock port (the host detaches the
 * device instead of suspending it), so prevention is the only software
 * route with current hardware.
 *
 * Every `remote.keepaliveMs`, if the hub sits on the `remote` source and no
 * real user input happened within the interval, inject a tiny stick
 * excursion (LX 128→120) and restore — imperceptible, but resets the NS
 * idle timer. The jiggle is skipped whenever recent non-neutral input
 * exists, so it never fights live gameplay.
 */
export class KeepaliveService {
  private timer: NodeJS.Timeout | null = null;
  private lastActivity = 0;
  private prevSource: string | null = null;
  private offReport: () => void = () => {};
  private offState: () => void = () => {};

  constructor(
    private hub: InputHub,
    private device: DeviceService,
    private config: ConfigStore,
  ) {}

  start(): void {
    this.stop();
    this.lastActivity = Date.now();
    this.prevSource = this.hub.getState().activeSource;
    this.offReport = this.hub.on("reportSent", (report) => {
      if (!isNeutralReport(report)) this.lastActivity = Date.now();
    });
    this.offState = this.hub.on("stateChanged", () => {
      const source = this.hub.getState().activeSource;
      if (source === "remote" && this.prevSource !== "remote") {
        this.lastActivity = Date.now();
      }
      this.prevSource = source;
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.offReport();
    this.offState();
    this.offReport = () => {};
    this.offState = () => {};
  }

  /** One keepalive check; public so tests can drive it without timers. */
  tick(): void {
    const { keepaliveMs } = this.config.get().remote;
    if (keepaliveMs <= 0) return;
    if (this.hub.getState().activeSource !== "remote") return;
    if (!this.device.isConnected) return;
    if (Date.now() - this.lastActivity < keepaliveMs) return;
    void this.sendJiggle();
  }

  private async sendJiggle(): Promise<void> {
    this.lastActivity = Date.now();
    try {
      await this.device.sendReport({
        buttons: NEUTRAL_REPORT.buttons,
        hat: NEUTRAL_REPORT.hat,
        lx: NEUTRAL_REPORT.lx - 8,
        ly: NEUTRAL_REPORT.ly,
        rx: NEUTRAL_REPORT.rx,
        ry: NEUTRAL_REPORT.ry,
      });
      await sleep(60);
      await this.device.sendReport({ ...NEUTRAL_REPORT });
    } catch {
      /* device gone mid-jiggle: next tick re-checks connectivity */
    }
  }
}

import { SwitchButton, SwitchHat, STICK_CENTER } from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";

/**
 * Aggregated touch input → PadReport. Values are clamped to the protocol
 * domain so a stray pointer event can never push an invalid frame downstream.
 */
export class PadInputState {
  private buttons = 0;
  private hat: number = SwitchHat.CENTER;
  private lx = STICK_CENTER;
  private ly = STICK_CENTER;

  setButton(name: string, down: boolean): void {
    const bit = (SwitchButton as Record<string, number>)[name];
    if (bit === undefined) return;
    this.buttons = down ? this.buttons | bit : this.buttons & ~bit;
  }

  setHat(hat: number): void {
    if (hat >= SwitchHat.TOP && hat <= SwitchHat.CENTER) this.hat = hat;
  }

  setLeftStick(x: number, y: number): void {
    const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
    this.lx = clamp(x);
    this.ly = clamp(y);
  }

  reset(): void {
    this.buttons = 0;
    this.hat = SwitchHat.CENTER;
    this.lx = STICK_CENTER;
    this.ly = STICK_CENTER;
  }

  report(): PadReport {
    // Right stick has no touch surface in v1: stays centered.
    return {
      buttons: this.buttons,
      hat: this.hat,
      lx: this.lx,
      ly: this.ly,
      rx: STICK_CENTER,
      ry: STICK_CENTER,
    };
  }
}

const NEUTRAL_JSON = JSON.stringify({
  buttons: 0,
  hat: SwitchHat.CENTER,
  lx: STICK_CENTER,
  ly: STICK_CENTER,
  rx: STICK_CENTER,
  ry: STICK_CENTER,
});

/** True when `report` equals the neutral frame (no need to hit the wire). */
export function isNeutralReport(report: PadReport): boolean {
  return JSON.stringify(report) === NEUTRAL_JSON;
}

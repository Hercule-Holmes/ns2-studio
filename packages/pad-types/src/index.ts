export interface PadReport {
  buttons: number;
  hat: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export interface TimedPadReport extends PadReport {
  tUs: number;
}

export const STICK_MIN = 0;
export const STICK_CENTER = 128;
export const STICK_MAX = 255;

export const SwitchButton = {
  Y: 0x0001,
  B: 0x0002,
  A: 0x0004,
  X: 0x0008,
  L: 0x0010,
  R: 0x0020,
  ZL: 0x0040,
  ZR: 0x0080,
  MINUS: 0x0100,
  PLUS: 0x0200,
  LCLICK: 0x0400,
  RCLICK: 0x0800,
  HOME: 0x1000,
  CAPTURE: 0x2000,
} as const;

export type SwitchButtonName = keyof typeof SwitchButton;

export const SwitchHat = {
  TOP: 0,
  TOP_RIGHT: 1,
  RIGHT: 2,
  BOTTOM_RIGHT: 3,
  BOTTOM: 4,
  BOTTOM_LEFT: 5,
  LEFT: 6,
  TOP_LEFT: 7,
  CENTER: 8,
} as const;

export type SwitchHatName = keyof typeof SwitchHat;

export const NEUTRAL_REPORT: PadReport = {
  buttons: 0,
  hat: SwitchHat.CENTER,
  lx: STICK_CENTER,
  ly: STICK_CENTER,
  rx: STICK_CENTER,
  ry: STICK_CENTER,
};

export function isNeutral(report: PadReport): boolean {
  return (
    report.buttons === 0 &&
    report.hat === SwitchHat.CENTER &&
    report.lx === STICK_CENTER &&
    report.ly === STICK_CENTER &&
    report.rx === STICK_CENTER &&
    report.ry === STICK_CENTER
  );
}

export function clampStick(value: number): number {
  if (!Number.isFinite(value)) return STICK_CENTER;
  return Math.min(STICK_MAX, Math.max(STICK_MIN, Math.round(value)));
}

export function mergeButtons(...buttons: number[]): number {
  let out = 0;
  for (const b of buttons) out |= b;
  return out;
}

export function nameToButton(name: string): number {
  const bit = (SwitchButton as Record<string, number>)[name];
  if (bit === undefined) throw new Error(`unknown button name: ${name}`);
  return bit;
}

export function buttonToName(buttons: number): string[] {
  const names: string[] = [];
  for (const [name, bit] of Object.entries(SwitchButton)) {
    if ((buttons & bit) !== 0) names.push(name);
  }
  return names;
}
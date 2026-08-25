import { SwitchButton, SwitchHat } from "@ns2-studio/pad-types";

/**
 * Key-to-pad mapping model (S3 §3.3). Pure data + helpers so the editing
 * form and the capture loop share one source of truth and stay unit-testable.
 */
export type KeyMapTarget =
  | { kind: "hat"; dir: number }
  | { kind: "button"; bit: number }
  | { kind: "stick"; axis: "x" | "y"; sign: -1 | 1 };

export interface KeyMapping {
  id: string;
  /** KeyboardEvent.code, e.g. "KeyW" / "Semicolon". */
  code: string;
  /** Short display label, e.g. "W". */
  label: string;
  target: KeyMapTarget;
}

let counter = 0;

export function mkMapping(
  code: string,
  label: string,
  target: KeyMapTarget,
): KeyMapping {
  counter += 1;
  return { id: `map-${counter}`, code, label, target };
}

/** Defaults: WASD = HAT, J/K/U/I = ABXY (S3 §3.3). */
export function defaultKeyMappings(): KeyMapping[] {
  return [
    mkMapping("KeyW", "W", { kind: "hat", dir: SwitchHat.TOP }),
    mkMapping("KeyS", "S", { kind: "hat", dir: SwitchHat.BOTTOM }),
    mkMapping("KeyA", "A", { kind: "hat", dir: SwitchHat.LEFT }),
    mkMapping("KeyD", "D", { kind: "hat", dir: SwitchHat.RIGHT }),
    mkMapping("KeyJ", "J", { kind: "button", bit: SwitchButton.A }),
    mkMapping("KeyK", "K", { kind: "button", bit: SwitchButton.B }),
    mkMapping("KeyU", "U", { kind: "button", bit: SwitchButton.X }),
    mkMapping("KeyI", "I", { kind: "button", bit: SwitchButton.Y }),
    mkMapping("KeyH", "H", { kind: "button", bit: SwitchButton.L }),
    mkMapping("KeyL", "L", { kind: "button", bit: SwitchButton.R }),
    mkMapping("KeyG", "G", { kind: "button", bit: SwitchButton.ZL }),
    mkMapping("Semicolon", ";", { kind: "button", bit: SwitchButton.ZR }),
    mkMapping("Minus", "-", { kind: "button", bit: SwitchButton.MINUS }),
    mkMapping("Equal", "=", { kind: "button", bit: SwitchButton.PLUS }),
    mkMapping("Space", "Space", { kind: "button", bit: SwitchButton.HOME }),
    mkMapping("KeyV", "V", { kind: "button", bit: SwitchButton.CAPTURE }),
  ];
}

export function findMapping(
  mappings: KeyMapping[],
  code: string,
): KeyMapping | undefined {
  return mappings.find((m) => m.code === code);
}

export function hasDuplicateCode(mappings: KeyMapping[]): boolean {
  const seen = new Set<string>();
  for (const m of mappings) {
    if (seen.has(m.code)) return true;
    seen.add(m.code);
  }
  return false;
}

export function targetLabel(target: KeyMapTarget): string {
  switch (target.kind) {
    case "hat":
      return `HAT ${SwitchHatName[target.dir] ?? target.dir}`;
    case "button":
      return `按钮 ${SwitchButtonName[target.bit] ?? target.bit}`;
    case "stick":
      return `摇杆${target.axis.toUpperCase()}${target.sign < 0 ? "上/左" : "下/右"}`;
  }
}

const SwitchHatName: Record<number, string> = {
  [SwitchHat.TOP]: "上",
  [SwitchHat.TOP_RIGHT]: "右上",
  [SwitchHat.RIGHT]: "右",
  [SwitchHat.BOTTOM_RIGHT]: "右下",
  [SwitchHat.BOTTOM]: "下",
  [SwitchHat.BOTTOM_LEFT]: "左下",
  [SwitchHat.LEFT]: "左",
  [SwitchHat.TOP_LEFT]: "左上",
  [SwitchHat.CENTER]: "中",
};

const SwitchButtonName: Record<number, string> = {
  [SwitchButton.Y]: "Y",
  [SwitchButton.B]: "B",
  [SwitchButton.A]: "A",
  [SwitchButton.X]: "X",
  [SwitchButton.L]: "L",
  [SwitchButton.R]: "R",
  [SwitchButton.ZL]: "ZL",
  [SwitchButton.ZR]: "ZR",
  [SwitchButton.MINUS]: "−",
  [SwitchButton.PLUS]: "+",
  [SwitchButton.LCLICK]: "L3",
  [SwitchButton.RCLICK]: "R3",
  [SwitchButton.HOME]: "Home",
  [SwitchButton.CAPTURE]: "Capture",
};

/** Display label for a KeyboardEvent.code (e.g. "KeyW" -> "W"). */
export function codeLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

export const BUTTON_LABELS: Array<{ bit: number; label: string }> = [
  { bit: SwitchButton.A, label: "A" },
  { bit: SwitchButton.B, label: "B" },
  { bit: SwitchButton.X, label: "X" },
  { bit: SwitchButton.Y, label: "Y" },
  { bit: SwitchButton.L, label: "L" },
  { bit: SwitchButton.R, label: "R" },
  { bit: SwitchButton.ZL, label: "ZL" },
  { bit: SwitchButton.ZR, label: "ZR" },
  { bit: SwitchButton.MINUS, label: "−" },
  { bit: SwitchButton.PLUS, label: "+" },
  { bit: SwitchButton.LCLICK, label: "L3" },
  { bit: SwitchButton.RCLICK, label: "R3" },
  { bit: SwitchButton.HOME, label: "Home" },
  { bit: SwitchButton.CAPTURE, label: "Capture" },
];

export const HAT_DIRS: Array<{ dir: number; label: string }> = [
  { dir: SwitchHat.TOP, label: "上" },
  { dir: SwitchHat.TOP_RIGHT, label: "右上" },
  { dir: SwitchHat.RIGHT, label: "右" },
  { dir: SwitchHat.BOTTOM_RIGHT, label: "右下" },
  { dir: SwitchHat.BOTTOM, label: "下" },
  { dir: SwitchHat.BOTTOM_LEFT, label: "左下" },
  { dir: SwitchHat.LEFT, label: "左" },
  { dir: SwitchHat.TOP_LEFT, label: "左上" },
];

export const STICK_VALUES: Array<{
  value: string;
  axis: "x" | "y";
  sign: -1 | 1;
  label: string;
}> = [
  { value: "x-", axis: "x", sign: -1, label: "左" },
  { value: "x+", axis: "x", sign: 1, label: "右" },
  { value: "y-", axis: "y", sign: -1, label: "上" },
  { value: "y+", axis: "y", sign: 1, label: "下" },
];
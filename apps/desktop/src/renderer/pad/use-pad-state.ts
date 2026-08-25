import { computed, reactive, ref } from "vue";
import type { PadReport } from "@ns2-studio/pad-types";
import {
  STICK_CENTER,
  STICK_MAX,
  STICK_MIN,
  SwitchHat,
  clampStick,
} from "@ns2-studio/pad-types";
import type { KeyMapping } from "./keymap";
import { findMapping } from "./keymap";

export interface StickState {
  x: number;
  y: number;
  active: boolean;
}

/**
 * Renderer-side pad state (S3 §3.2). Pointer and keyboard sources are merged
 * into a single reactive PadReport; pointer wins for sticks/hat while held.
 * The page wires `report` into `window.api.pad.apply` (manual source only).
 */
export function usePadState(getMappings: () => KeyMapping[]) {
  const pointerButtons = ref(0);
  const keyboardButtons = ref(0);
  const pointerHat = ref<number>(SwitchHat.CENTER);
  const keyboardHat = ref<number>(SwitchHat.CENTER);
  const leftStick = reactive<StickState>({
    x: STICK_CENTER,
    y: STICK_CENTER,
    active: false,
  });
  const rightStick = reactive<StickState>({
    x: STICK_CENTER,
    y: STICK_CENTER,
    active: false,
  });
  const keyboardLeft = reactive({ x: STICK_CENTER, y: STICK_CENTER });
  const keyboardRight = reactive({ x: STICK_CENTER, y: STICK_CENTER });
  const holdLeft = ref(false);
  const holdRight = ref(false);
  const heldCodes: string[] = [];

  const report = computed<PadReport>(() => ({
    buttons: pointerButtons.value | keyboardButtons.value,
    hat:
      pointerHat.value !== SwitchHat.CENTER
        ? pointerHat.value
        : keyboardHat.value,
    lx: leftStick.active || holdLeft.value ? leftStick.x : keyboardLeft.x,
    ly: leftStick.active || holdLeft.value ? leftStick.y : keyboardLeft.y,
    rx: rightStick.active || holdRight.value ? rightStick.x : keyboardRight.x,
    ry: rightStick.active || holdRight.value ? rightStick.y : keyboardRight.y,
  }));

  function pressPointerButton(bit: number): void {
    pointerButtons.value |= bit;
  }

  function releasePointerButton(bit: number): void {
    pointerButtons.value &= ~bit;
  }

  function setPointerHat(dir: number): void {
    pointerHat.value = dir;
  }

  function resetPointerHat(): void {
    pointerHat.value = SwitchHat.CENTER;
  }

  function recomputeKeyboard(): void {
    let buttons = 0;
    let hat: number = SwitchHat.CENTER;
    let hasHat = false;
    const left = { x: STICK_CENTER, y: STICK_CENTER };
    for (const code of heldCodes) {
      const m = findMapping(getMappings(), code);
      if (!m) continue;
      const t = m.target;
      if (t.kind === "button") {
        buttons |= t.bit;
      } else if (t.kind === "hat") {
        if (!hasHat) {
          hat = t.dir;
          hasHat = true;
        }
      } else {
        if (t.axis === "x") left.x = t.sign < 0 ? STICK_MIN : STICK_MAX;
        else left.y = t.sign < 0 ? STICK_MIN : STICK_MAX;
      }
    }
    keyboardButtons.value = buttons;
    keyboardHat.value = hat;
    keyboardLeft.x = left.x;
    keyboardLeft.y = left.y;
  }

  /** Returns false if the key is already held or unmapped. */
  function pressKey(code: string): boolean {
    if (heldCodes.includes(code)) return false;
    if (!findMapping(getMappings(), code)) return false;
    heldCodes.push(code);
    recomputeKeyboard();
    return true;
  }

  function releaseKey(code: string): void {
    const idx = heldCodes.indexOf(code);
    if (idx < 0) return;
    heldCodes.splice(idx, 1);
    recomputeKeyboard();
  }

  function setStick(stick: "left" | "right", x: number, y: number): void {
    const s = stick === "left" ? leftStick : rightStick;
    s.x = clampStick(x);
    s.y = clampStick(y);
    s.active = true;
  }

  function releaseStick(stick: "left" | "right", hold: boolean): void {
    const s = stick === "left" ? leftStick : rightStick;
    s.active = false;
    if (stick === "left") holdLeft.value = hold;
    else holdRight.value = hold;
    if (!hold) {
      s.x = STICK_CENTER;
      s.y = STICK_CENTER;
    }
  }

  function resetAll(): void {
    pointerButtons.value = 0;
    keyboardButtons.value = 0;
    pointerHat.value = SwitchHat.CENTER;
    keyboardHat.value = SwitchHat.CENTER;
    heldCodes.length = 0;
    leftStick.x = STICK_CENTER;
    leftStick.y = STICK_CENTER;
    leftStick.active = false;
    rightStick.x = STICK_CENTER;
    rightStick.y = STICK_CENTER;
    rightStick.active = false;
    keyboardLeft.x = STICK_CENTER;
    keyboardLeft.y = STICK_CENTER;
    keyboardRight.x = STICK_CENTER;
    keyboardRight.y = STICK_CENTER;
    holdLeft.value = false;
    holdRight.value = false;
  }

  return {
    report,
    pointerButtons,
    pointerHat,
    leftStick,
    rightStick,
    pressPointerButton,
    releasePointerButton,
    setPointerHat,
    resetPointerHat,
    pressKey,
    releaseKey,
    setStick,
    releaseStick,
    resetAll,
  };
}

/** Minimal geometry surface used by stick drags (avoids DOM types in tests). */
export interface StickElement {
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/** Map a pointer position over a stick element into a PadReport stick value. */
export function stickValueFromPointer(
  el: StickElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
  let nx = (clientX - cx) / radius;
  let ny = (clientY - cy) / radius;
  const len = Math.hypot(nx, ny);
  if (len > 1) {
    nx /= len;
    ny /= len;
  }
  return {
    x: clampStick(STICK_CENTER + Math.trunc(nx * (STICK_MAX - STICK_CENTER + 1))),
    y: clampStick(STICK_CENTER + Math.trunc(ny * (STICK_MAX - STICK_CENTER + 1))),
  };
}
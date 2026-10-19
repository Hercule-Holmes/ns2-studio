import { SwitchHat, STICK_CENTER } from "@ns2-studio/pad-types";
import type { PadInputState } from "./state";

/**
 * Wires the static gamepad DOM to a PadInputState: press/release for every
 * `[data-btn]`, hat for `[data-hat]`, and an absolute-position virtual stick.
 * All handlers use Pointer Events so multi-touch works per-finger.
 */
export function wireGamepad(
  root: HTMLElement,
  stick: HTMLElement,
  knob: HTMLElement,
  state: PadInputState,
  onInput: () => void,
): void {
  // ---- face / shoulder / system buttons ----
  for (const el of root.querySelectorAll<HTMLElement>("[data-btn]")) {
    const name = el.dataset.btn!;
    const down = (ev: PointerEvent) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      el.classList.add("pressed");
      state.setButton(name, true);
      onInput();
    };
    const up = (ev: PointerEvent) => {
      ev.preventDefault();
      el.classList.remove("pressed");
      state.setButton(name, false);
      onInput();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", () => {
      if (el.classList.contains("pressed")) {
        el.classList.remove("pressed");
        state.setButton(name, false);
        onInput();
      }
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- hat (d-pad) ----
  const hatEls = [...root.querySelectorAll<HTMLElement>("[data-hat]")];
  const hatPressCounts = new Map<number, number>();
  const applyHat = () => {
    // Deepest priority: last pressed direction wins; center when none held.
    let active: number = SwitchHat.CENTER;
    for (const [hat, n] of hatPressCounts) if (n > 0) active = hat;
    state.setHat(active);
    onInput();
  };
  for (const el of hatEls) {
    const hat = Number(el.dataset.hat);
    const down = (ev: PointerEvent) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      el.classList.add("pressed");
      hatPressCounts.set(hat, (hatPressCounts.get(hat) ?? 0) + 1);
      applyHat();
    };
    const up = () => {
      el.classList.remove("pressed");
      hatPressCounts.set(hat, Math.max(0, (hatPressCounts.get(hat) ?? 0) - 1));
      applyHat();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", () => {
      if (el.classList.contains("pressed")) {
        el.classList.remove("pressed");
        hatPressCounts.set(hat, Math.max(0, (hatPressCounts.get(hat) ?? 0) - 1));
        applyHat();
      }
    });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- virtual stick ----
  const stickPointer = { id: -1 };
  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const handleStick = (ev: PointerEvent, fromDown: boolean) => {
    ev.preventDefault();
    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2 - 6;
    if (fromDown) {
      stickPointer.id = ev.pointerId;
      stick.setPointerCapture(ev.pointerId);
      stick.classList.add("active");
    }
    if (ev.pointerId !== stickPointer.id) return;
    if (!fromDown) {
      // move
    }
    let dx = ev.clientX - (rect.left + rect.width / 2);
    let dy = ev.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    setKnob(dx, dy);
    state.setLeftStick(STICK_CENTER + (dx / radius) * 127, STICK_CENTER + (dy / radius) * 127);
    onInput();
  };
  stick.addEventListener("pointerdown", (ev) => handleStick(ev, true));
  stick.addEventListener("pointermove", (ev) => {
    if (stickPointer.id === ev.pointerId) handleStick(ev, false);
  });
  const stickUp = (ev: PointerEvent) => {
    if (ev.pointerId !== stickPointer.id) return;
    stickPointer.id = -1;
    stick.classList.remove("active");
    setKnob(0, 0);
    state.setLeftStick(STICK_CENTER, STICK_CENTER);
    onInput();
  };
  stick.addEventListener("pointerup", stickUp);
  stick.addEventListener("pointercancel", stickUp);
  stick.addEventListener("lostpointercapture", () => {
    if (stickPointer.id !== -1) {
      stickPointer.id = -1;
      stick.classList.remove("active");
      setKnob(0, 0);
      state.setLeftStick(STICK_CENTER, STICK_CENTER);
      onInput();
    }
  });
  stick.addEventListener("contextmenu", (e) => e.preventDefault());
}

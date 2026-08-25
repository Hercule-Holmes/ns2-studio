import { describe, expect, it } from "vitest";
import {
  NEUTRAL_REPORT,
  STICK_CENTER,
  STICK_MAX,
  STICK_MIN,
  SwitchButton,
  SwitchHat,
} from "@ns2-studio/pad-types";
import type { KeyMapping } from "../src/renderer/pad/keymap";
import { defaultKeyMappings } from "../src/renderer/pad/keymap";
import {
  stickValueFromPointer,
  usePadState,
} from "../src/renderer/pad/use-pad-state";

function makePad(mappings: () => KeyMapping[] = defaultKeyMappings) {
  return usePadState(mappings);
}

describe("usePadState", () => {
  it("starts at the neutral report", () => {
    const pad = makePad();
    expect(pad.report.value).toEqual(NEUTRAL_REPORT);
  });

  it("merges pointer buttons and produces a clean release", () => {
    const pad = makePad();
    pad.pressPointerButton(SwitchButton.A);
    expect(pad.report.value.buttons & SwitchButton.A).toBe(SwitchButton.A);

    pad.pressPointerButton(SwitchButton.B);
    expect(
      pad.report.value.buttons & (SwitchButton.A | SwitchButton.B),
    ).toBe(SwitchButton.A | SwitchButton.B);

    pad.releasePointerButton(SwitchButton.A);
    expect(pad.report.value.buttons & SwitchButton.A).toBe(0);
    expect(pad.report.value.buttons & SwitchButton.B).toBe(SwitchButton.B);

    pad.releasePointerButton(SwitchButton.B);
    expect(pad.report.value).toEqual(NEUTRAL_REPORT);
  });

  it("pointer hat wins over keyboard hat while held", () => {
    const pad = makePad();
    pad.pressKey("KeyW"); // HAT TOP
    expect(pad.report.value.hat).toBe(SwitchHat.TOP);

    pad.setPointerHat(SwitchHat.RIGHT);
    expect(pad.report.value.hat).toBe(SwitchHat.RIGHT);

    pad.resetPointerHat();
    expect(pad.report.value.hat).toBe(SwitchHat.TOP);

    pad.releaseKey("KeyW");
    expect(pad.report.value.hat).toBe(SwitchHat.CENTER);
  });

  it("keyboard buttons press and release through the mapping", () => {
    const pad = makePad();
    expect(pad.pressKey("KeyJ")).toBe(true); // A
    expect(pad.pressKey("KeyI")).toBe(true); // Y
    expect(pad.report.value.buttons).toBe(SwitchButton.A | SwitchButton.Y);

    pad.releaseKey("KeyJ");
    expect(pad.report.value.buttons).toBe(SwitchButton.Y);
    pad.releaseKey("KeyI");
    expect(pad.report.value).toEqual(NEUTRAL_REPORT);
  });

  it("ignores unmapped keys and duplicate press", () => {
    const pad = makePad();
    expect(pad.pressKey("KeyQ")).toBe(false);
    expect(pad.pressKey("KeyJ")).toBe(true);
    expect(pad.pressKey("KeyJ")).toBe(false);
    pad.releaseKey("KeyJ");
    expect(pad.report.value).toEqual(NEUTRAL_REPORT);
  });

  it("WASD mapped to stick drives extreme stick values", () => {
    const mappings = defaultKeyMappings();
    const w = mappings.find((m) => m.code === "KeyW")!;
    w.target = { kind: "stick", axis: "y", sign: -1 };
    const a = mappings.find((m) => m.code === "KeyA")!;
    a.target = { kind: "stick", axis: "x", sign: -1 };

    const pad = makePad(() => mappings);
    pad.pressKey("KeyW");
    expect(pad.report.value.ly).toBe(STICK_MIN);
    pad.pressKey("KeyA");
    expect(pad.report.value.lx).toBe(STICK_MIN);
    pad.releaseKey("KeyW");
    pad.releaseKey("KeyA");
    expect(pad.report.value.lx).toBe(STICK_CENTER);
    expect(pad.report.value.ly).toBe(STICK_CENTER);
  });

  it("releaseStick without hold recenters; with hold keeps value", () => {
    const pad = makePad();
    pad.setStick("left", STICK_MAX, STICK_MIN);
    pad.releaseStick("left", false);
    expect(pad.report.value.lx).toBe(STICK_CENTER);
    expect(pad.report.value.ly).toBe(STICK_CENTER);

    pad.setStick("right", STICK_MIN, STICK_MAX);
    pad.releaseStick("right", true);
    expect(pad.report.value.rx).toBe(STICK_MIN);
    expect(pad.report.value.ry).toBe(STICK_MAX);
  });

  it("resetAll returns to neutral", () => {
    const pad = makePad();
    pad.pressPointerButton(SwitchButton.A);
    pad.setPointerHat(SwitchHat.LEFT);
    pad.setStick("left", STICK_MAX, STICK_MAX);
    pad.pressKey("KeyK");
    pad.resetAll();
    expect(pad.report.value).toEqual(NEUTRAL_REPORT);
  });
});

describe("stickValueFromPointer", () => {
  const el = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    }),
  };

  it("centers when the pointer is at the middle", () => {
    const { x, y } = stickValueFromPointer(el, 50, 50);
    expect(x).toBe(STICK_CENTER);
    expect(y).toBe(STICK_CENTER);
  });

  it("maps right/down to max and left/up to min", () => {
    expect(stickValueFromPointer(el, 100, 50).x).toBe(STICK_MAX);
    expect(stickValueFromPointer(el, 50, 100).y).toBe(STICK_MAX);
    expect(stickValueFromPointer(el, 0, 50).x).toBe(STICK_MIN);
    expect(stickValueFromPointer(el, 50, 0).y).toBe(STICK_MIN);
  });

  it("clamps outside the circle to the max magnitude", () => {
    const { x, y } = stickValueFromPointer(el, 1000, 1000);
    expect(x).toBeGreaterThanOrEqual(STICK_MIN);
    expect(x).toBeLessThanOrEqual(STICK_MAX);
    expect(y).toBeGreaterThanOrEqual(STICK_MIN);
    expect(y).toBeLessThanOrEqual(STICK_MAX);
    expect(Math.hypot(x - STICK_CENTER, y - STICK_CENTER)).toBeLessThanOrEqual(
      STICK_MAX - STICK_CENTER + 1,
    );
  });
});
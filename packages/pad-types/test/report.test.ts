import { describe, expect, it } from "vitest";
import {
  NEUTRAL_REPORT,
  STICK_CENTER,
  SwitchButton,
  SwitchHat,
  buttonToName,
  clampStick,
  isNeutral,
  mergeButtons,
  nameToButton,
} from "../src/index";

describe("SwitchButton", () => {
  it("matches the protocol bit table", () => {
    expect(SwitchButton.Y).toBe(0x0001);
    expect(SwitchButton.B).toBe(0x0002);
    expect(SwitchButton.A).toBe(0x0004);
    expect(SwitchButton.X).toBe(0x0008);
    expect(SwitchButton.L).toBe(0x0010);
    expect(SwitchButton.R).toBe(0x0020);
    expect(SwitchButton.ZL).toBe(0x0040);
    expect(SwitchButton.ZR).toBe(0x0080);
    expect(SwitchButton.MINUS).toBe(0x0100);
    expect(SwitchButton.PLUS).toBe(0x0200);
    expect(SwitchButton.LCLICK).toBe(0x0400);
    expect(SwitchButton.RCLICK).toBe(0x0800);
    expect(SwitchButton.HOME).toBe(0x1000);
    expect(SwitchButton.CAPTURE).toBe(0x2000);
  });
});

describe("SwitchHat", () => {
  it("matches the protocol HAT table", () => {
    expect(SwitchHat.TOP).toBe(0);
    expect(SwitchHat.TOP_RIGHT).toBe(1);
    expect(SwitchHat.RIGHT).toBe(2);
    expect(SwitchHat.BOTTOM_RIGHT).toBe(3);
    expect(SwitchHat.BOTTOM).toBe(4);
    expect(SwitchHat.BOTTOM_LEFT).toBe(5);
    expect(SwitchHat.LEFT).toBe(6);
    expect(SwitchHat.TOP_LEFT).toBe(7);
    expect(SwitchHat.CENTER).toBe(8);
  });
});

describe("NEUTRAL_REPORT", () => {
  it("has zero buttons, center hat and sticks", () => {
    expect(NEUTRAL_REPORT).toEqual({
      buttons: 0,
      hat: 8,
      lx: 128,
      ly: 128,
      rx: 128,
      ry: 128,
    });
  });
});

describe("isNeutral", () => {
  it("is true for the neutral report", () => {
    expect(isNeutral(NEUTRAL_REPORT)).toBe(true);
  });

  it("is false when any field deviates", () => {
    expect(isNeutral({ ...NEUTRAL_REPORT, buttons: SwitchButton.A })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_REPORT, hat: SwitchHat.LEFT })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_REPORT, lx: 0 })).toBe(false);
    expect(isNeutral({ ...NEUTRAL_REPORT, ry: 255 })).toBe(false);
  });
});

describe("clampStick", () => {
  it("clamps to 0..255 and rounds", () => {
    expect(clampStick(0)).toBe(0);
    expect(clampStick(128)).toBe(128);
    expect(clampStick(255)).toBe(255);
    expect(clampStick(-5)).toBe(0);
    expect(clampStick(300)).toBe(255);
    expect(clampStick(128.6)).toBe(129);
    expect(clampStick(Number.NaN)).toBe(STICK_CENTER);
    expect(clampStick(Number.POSITIVE_INFINITY)).toBe(STICK_CENTER);
  });
});

describe("mergeButtons", () => {
  it("ORs bit flags together", () => {
    expect(mergeButtons(SwitchButton.A, SwitchButton.B)).toBe(0x0006);
    expect(mergeButtons(SwitchButton.A, SwitchButton.B, SwitchButton.L)).toBe(0x0016);
    expect(mergeButtons()).toBe(0);
  });
});

describe("nameToButton / buttonToName", () => {
  it("maps a name to its bit value", () => {
    expect(nameToButton("A")).toBe(0x0004);
    expect(nameToButton("CAPTURE")).toBe(0x2000);
    expect(() => nameToButton("NOT_A_BUTTON")).toThrow();
  });

  it("lists pressed button names", () => {
    expect(buttonToName(0x0016)).toEqual(["B", "A", "L"]);
    expect(buttonToName(0)).toEqual([]);
  });
});
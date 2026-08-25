import { describe, expect, it } from "vitest";
import {
  SwitchButton,
  SwitchHat,
} from "@ns2-studio/pad-types";
import {
  codeLabel,
  defaultKeyMappings,
  findMapping,
  hasDuplicateCode,
} from "../src/renderer/pad/keymap";

describe("keymap", () => {
  it("defaults WASD to HAT and J/K/U/I to ABXY", () => {
    const mappings = defaultKeyMappings();
    expect(findMapping(mappings, "KeyW")?.target).toEqual({
      kind: "hat",
      dir: SwitchHat.TOP,
    });
    expect(findMapping(mappings, "KeyS")?.target).toEqual({
      kind: "hat",
      dir: SwitchHat.BOTTOM,
    });
    expect(findMapping(mappings, "KeyA")?.target).toEqual({
      kind: "hat",
      dir: SwitchHat.LEFT,
    });
    expect(findMapping(mappings, "KeyD")?.target).toEqual({
      kind: "hat",
      dir: SwitchHat.RIGHT,
    });
    expect(findMapping(mappings, "KeyJ")?.target).toEqual({
      kind: "button",
      bit: SwitchButton.A,
    });
    expect(findMapping(mappings, "KeyK")?.target).toEqual({
      kind: "button",
      bit: SwitchButton.B,
    });
    expect(findMapping(mappings, "KeyU")?.target).toEqual({
      kind: "button",
      bit: SwitchButton.X,
    });
    expect(findMapping(mappings, "KeyI")?.target).toEqual({
      kind: "button",
      bit: SwitchButton.Y,
    });
  });

  it("findMapping returns undefined for unmapped keys", () => {
    expect(findMapping(defaultKeyMappings(), "KeyQ")).toBeUndefined();
  });

  it("detects duplicate codes", () => {
    const mappings = defaultKeyMappings();
    expect(hasDuplicateCode(mappings)).toBe(false);
    mappings[0]!.code = mappings[1]!.code;
    expect(hasDuplicateCode(mappings)).toBe(true);
  });

  it("formats code labels", () => {
    expect(codeLabel("KeyW")).toBe("W");
    expect(codeLabel("Digit3")).toBe("3");
    expect(codeLabel("Semicolon")).toBe("Semicolon");
  });
});
import { describe, expect, it } from "vitest";
import { STICK_CENTER, SwitchHat } from "@ns2-studio/pad-types";
import {
  NS2_PRO_PID,
  NS2_PRO_PID_SAFE_MODE,
  NS2_PRO_VID,
  buildInitCommands,
  isNs2ProSafeModeVidPid,
  isNs2ProVidPid,
  parseNs2ProReport,
} from "../src/main/capture/ns2-pro-parser";

/**
 * Fixed vectors built from docs/lab-notes/S8-ns2pro-protocol.md §3/§5/§8.
 * 12-bit packed sticks use the procon2-driver formula:
 *   x = b0 | ((b1 & 0x0F) << 8); y = (b1 >> 4) | (b2 << 4)
 * Center raw = 0x800 (2048) => u8 128; max raw = 0xFFF (4095) => u8 255.
 */
function makeFrame(opts: {
  counter?: number;
  power?: number;
  buttons?: [number, number, number];
  left?: [number, number, number];
  right?: [number, number, number];
  /** false -> BT-style 63-byte frame without report ID. */
  withId?: boolean;
}): Uint8Array {
  const body = new Uint8Array(63);
  body[0] = opts.counter ?? 0;
  body[1] = opts.power ?? 0;
  const [b0, b1, b2] = opts.buttons ?? [0, 0, 0];
  body[2] = b0;
  body[3] = b1;
  body[4] = b2;
  if (opts.left) {
    body[5] = opts.left[0];
    body[6] = opts.left[1];
    body[7] = opts.left[2];
  }
  if (opts.right) {
    body[8] = opts.right[0];
    body[9] = opts.right[1];
    body[10] = opts.right[2];
  }
  if (opts.withId === false) return body;
  const frame = new Uint8Array(64);
  frame[0] = 0x09;
  frame.set(body, 1);
  return frame;
}

// Center-packed sticks: x=0x800 y=0x800 -> b0=0x00 b1=0x08 b2=0x80.
const STICK_CENTER_PACKED: [number, number, number] = [0x00, 0x08, 0x80];
// Max-packed sticks: x=0xFFF y=0xFFF -> FF FF FF.
const STICK_MAX_PACKED: [number, number, number] = [0xff, 0xff, 0xff];

describe("parseNs2ProReport", () => {
  it("parses a neutral USB frame (report ID 0x09 header)", () => {
    const frame = makeFrame({
      counter: 7,
      left: STICK_CENTER_PACKED,
      right: STICK_CENTER_PACKED,
    });
    const parsed = parseNs2ProReport(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.counter).toBe(7);
    expect(parsed!.report).toEqual({
      buttons: 0,
      hat: SwitchHat.CENTER,
      lx: STICK_CENTER,
      ly: STICK_CENTER,
      rx: STICK_CENTER,
      ry: STICK_CENTER,
    });
  });

  it("maps the A+B button bitfield (byte 0x03 = 0x03)", () => {
    const frame = makeFrame({ buttons: [0x03, 0x00, 0x00] });
    const parsed = parseNs2ProReport(frame);
    expect(parsed!.report.buttons).toBe(0x0002 | 0x0004); // B | A
  });

  it("maps Y/X/R/ZR/Plus/RStick on byte 0x03", () => {
    const frame = makeFrame({ buttons: [0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x80, 0x00, 0x00] });
    const parsed = parseNs2ProReport(frame);
    expect(parsed!.report.buttons).toBe(0x0001 | 0x0008 | 0x0020 | 0x0080 | 0x0200 | 0x0800);
  });

  it("maps L/ZL/Minus/LStick on byte 0x04 and skips the D-Pad nibble", () => {
    const frame = makeFrame({ buttons: [0x00, 0x10 | 0x20 | 0x40 | 0x80, 0x00] });
    const parsed = parseNs2ProReport(frame);
    expect(parsed!.report.buttons).toBe(0x0010 | 0x0040 | 0x0100 | 0x0400);
  });

  it("maps Home/Capture on byte 0x05 and ignores C/GL/GR (R11)", () => {
    const frame = makeFrame({ buttons: [0x00, 0x00, 0x01 | 0x02 | 0x1c] });
    const parsed = parseNs2ProReport(frame);
    expect(parsed!.report.buttons).toBe(0x1000 | 0x2000); // Home | Capture only
  });

  it("maps D-Pad to HAT (0x04 nibble)", () => {
    const expectHat = (nibble: number, hat: number) => {
      const parsed = parseNs2ProReport(makeFrame({ buttons: [0x00, nibble, 0x00] }));
      expect(parsed!.report.hat).toBe(hat);
    };
    expectHat(0x08, SwitchHat.TOP); // Up
    expectHat(0x02, SwitchHat.RIGHT); // Right
    expectHat(0x08 | 0x02, SwitchHat.TOP_RIGHT); // Up+Right
    expectHat(0x01 | 0x02, SwitchHat.BOTTOM_RIGHT); // Right+Down
    expectHat(0x01, SwitchHat.BOTTOM); // Down
    expectHat(0x01 | 0x04, SwitchHat.BOTTOM_LEFT); // Down+Left
    expectHat(0x04, SwitchHat.LEFT); // Left
    expectHat(0x04 | 0x08, SwitchHat.TOP_LEFT); // Left+Up
    expectHat(0x08 | 0x01, SwitchHat.CENTER); // Up+Down conflict -> neutral
    expectHat(0x00, SwitchHat.CENTER); // none
  });

  it("unpacks 12-bit sticks to 0-255 (raw linear, uncalibrated)", () => {
    const parsed = parseNs2ProReport(
      makeFrame({ left: STICK_MAX_PACKED, right: STICK_MAX_PACKED }),
    );
    expect(parsed!.report.lx).toBe(255);
    expect(parsed!.report.ly).toBe(255);
    expect(parsed!.report.rx).toBe(255);
    expect(parsed!.report.ry).toBe(255);
    expect(parsed!.calibrated).toBe(false);
  });

  it("accepts a BT-style 63-byte frame without report ID", () => {
    const frame = makeFrame({ buttons: [0x01, 0x00, 0x00], withId: false });
    const parsed = parseNs2ProReport(frame);
    expect(parsed).not.toBeNull();
    expect(parsed!.report.buttons).toBe(0x0002); // B
  });

  it("rejects a 64-byte frame whose report ID is not 0x09", () => {
    const frame = makeFrame({ buttons: [0x01, 0x00, 0x00] });
    frame[0] = 0x00;
    expect(parseNs2ProReport(frame)).toBeNull();
  });

  it("rejects frames with an unexpected length", () => {
    expect(parseNs2ProReport(Uint8Array.from([0x09, 0x00]))).toBeNull();
    expect(parseNs2ProReport(new Uint8Array(32))).toBeNull();
  });

  it("reads counter and battery from power info", () => {
    const parsed = parseNs2ProReport(makeFrame({ counter: 5, power: 0b00010000 }));
    expect(parsed!.counter).toBe(5);
    expect(parsed!.battery).toBe(0b0100); // bits 2:5 = 4
  });

  it("applies a provided calibration with deadzone (procon2 normalize)", () => {
    const cal = { center: 2048, min: 294, max: 3735, deadzone: 50 };
    const center = parseNs2ProReport(
      makeFrame({ left: STICK_CENTER_PACKED, right: STICK_CENTER_PACKED }),
      { left: cal, right: cal },
    );
    expect(center!.report.lx).toBe(STICK_CENTER);
    expect(center!.report.ly).toBe(STICK_CENTER);
    expect(center!.calibrated).toBe(true);

    // Pack raw x = 3735 (0xE97), y = 0 -> b0=0x97 b1=0x0E b2=0x00.
    const max = parseNs2ProReport(
      makeFrame({ left: [0x97, 0x0e, 0x00], right: STICK_CENTER_PACKED }),
      { left: cal, right: cal },
    );
    expect(max!.report.lx).toBe(255);
    // Right stick center is inside the deadzone -> stays center.
    expect(max!.report.rx).toBe(STICK_CENTER);
    expect(max!.calibrated).toBe(true);
  });
});

describe("NS2 Pro identity / init commands", () => {
  it("matches VID/PID and excludes safe mode", () => {
    expect(isNs2ProVidPid(NS2_PRO_VID, NS2_PRO_PID)).toBe(true);
    expect(isNs2ProVidPid(0x1234, 0x5678)).toBe(false);
    expect(isNs2ProSafeModeVidPid(NS2_PRO_VID, NS2_PRO_PID_SAFE_MODE)).toBe(true);
    expect(isNs2ProSafeModeVidPid(NS2_PRO_VID, NS2_PRO_PID)).toBe(false);
  });

  it("builds the minimal USB init command set (0x0D then 0x0A)", () => {
    const cmds = buildInitCommands();
    expect(cmds.length).toBe(2);
    expect(cmds[0]![0]).toBe(0x03);
    expect(cmds[0]![3]).toBe(0x0d);
    expect(cmds[1]![0]).toBe(0x03);
    expect(cmds[1]![3]).toBe(0x0a);
    expect(cmds[1]![8]).toBe(0x09); // selected report ID
  });
});
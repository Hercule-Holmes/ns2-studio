import {
  STICK_CENTER,
  STICK_MAX,
  STICK_MIN,
  SwitchButton,
  SwitchHat,
  clampStick,
} from "@ns2-studio/pad-types";
import type { PadReport } from "@ns2-studio/pad-types";

/**
 * NS2 Pro (Pro Controller 2) wired protocol parser.
 *
 * Source of truth: docs/lab-notes/S8-ns2pro-protocol.md (§3/§4/§5/§8), which in
 * turn derives from ndeadly/switch2_controller_research (hid_reports.md) and
 * dalmatheo/procon2-driver. All unverified fields are treated conservatively:
 * the parser never guesses beyond the documented layout.
 *
 * Frame shapes accepted:
 *   - USB: 64 bytes, `[0]` = report ID `0x09`, body at `[1..63]`
 *   - BT : 63 bytes, no report ID header
 * Anything else (wrong length / first byte not 0x09 on a 64-byte frame) is
 * treated as "unsupported" and returns `null` (capture must not emit).
 */

export const NS2_PRO_VID = 0x057e;
export const NS2_PRO_PID = 0x2069;
export const NS2_PRO_PID_SAFE_MODE = 0x2072;

export const NS2_PRO_REPORT_ID = 0x09;
export const NS2_PRO_USB_FRAME_LEN = 64;
export const NS2_PRO_BT_FRAME_LEN = 63;

/** Body offsets (after report-ID strip) per lab-note §3 USB offset table - 1. */
const OFF_COUNTER = 0x00;
const OFF_POWER = 0x01;
const OFF_BUTTONS = 0x02;
const OFF_LEFT_STICK = 0x05;
const OFF_RIGHT_STICK = 0x08;

/**
 * Optional per-stick calibration (lab-note §6). Calibration block format is
 * unverified, so default is `undefined` -> raw linear mapping (raw >> 4).
 */
export interface StickCalibration {
  center: number;
  min: number;
  max: number;
  deadzone: number;
}

export interface Ns2ProParserOptions {
  left?: StickCalibration;
  right?: StickCalibration;
}

export interface ParsedNs2ProReport {
  report: PadReport;
  counter: number;
  powerInfo: number;
  /** Battery level 0-9 when the low 4 bits look valid, else undefined. */
  battery?: number;
  rawSticks: { lx: number; ly: number; rx: number; ry: number };
  /** false when no calibration was supplied (raw linear mapping used). */
  calibrated: boolean;
}

/** Command frames from lab-note §7.1 (minimal USB init set). */
export function buildInitCommands(): Uint8Array[] {
  return [
    // 0x03/0x0D Initialise USB (host addr dummy).
    Uint8Array.from([0x03, 0x91, 0x00, 0x0d, 0x00, 0x08, 0x00, 0x00, 0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    // 0x03/0x0A Select input report 0x09 (belt-and-braces reselect).
    Uint8Array.from([0x03, 0x91, 0x00, 0x0a, 0x00, 0x04, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00]),
  ];
}

const isNs2Pro = (vid: number, pid: number): boolean =>
  vid === NS2_PRO_VID && pid === NS2_PRO_PID;

export function isNs2ProVidPid(vid: number, pid: number): boolean {
  return isNs2Pro(vid, pid);
}

export function isNs2ProSafeModeVidPid(vid: number, pid: number): boolean {
  return vid === NS2_PRO_VID && pid === NS2_PRO_PID_SAFE_MODE;
}

// ---------------------------------------------------------------------------
// Button bitfield -> SwitchButton (lab-note §8)
// ---------------------------------------------------------------------------

/** Byte 0x03 bits (body index 0). */
const BTN_BYTE0: ReadonlyArray<{ mask: number; bit: number }> = [
  { mask: 0x01, bit: SwitchButton.B },
  { mask: 0x02, bit: SwitchButton.A },
  { mask: 0x04, bit: SwitchButton.Y },
  { mask: 0x08, bit: SwitchButton.X },
  { mask: 0x10, bit: SwitchButton.R },
  { mask: 0x20, bit: SwitchButton.ZR },
  { mask: 0x40, bit: SwitchButton.PLUS },
  { mask: 0x80, bit: SwitchButton.RCLICK },
];

/** Byte 0x04 bits: D-Pad occupy 0x0F; L/ZL/Minus/LStick above. */
const BTN_BYTE1: ReadonlyArray<{ mask: number; bit: number }> = [
  { mask: 0x10, bit: SwitchButton.L },
  { mask: 0x20, bit: SwitchButton.ZL },
  { mask: 0x40, bit: SwitchButton.MINUS },
  { mask: 0x80, bit: SwitchButton.LCLICK },
];

/** Byte 0x05 bits: Home/Capture mapped; C/GL/GR ignored (R11). */
const BTN_BYTE2: ReadonlyArray<{ mask: number; bit: number }> = [
  { mask: 0x01, bit: SwitchButton.HOME },
  { mask: 0x02, bit: SwitchButton.CAPTURE },
];

// ---------------------------------------------------------------------------
// D-Pad -> HAT (lab-note §8)
// ---------------------------------------------------------------------------

const DPAD_UP = 0x08;
const DPAD_DOWN = 0x01;
const DPAD_LEFT = 0x04;
const DPAD_RIGHT = 0x02;

function dpadToHat(up: boolean, down: boolean, left: boolean, right: boolean): number {
  // Opposing directions pressed together -> neutral (design decision, §8).
  if ((up && down) || (left && right)) return SwitchHat.CENTER;
  if (up && right) return SwitchHat.TOP_RIGHT;
  if (down && right) return SwitchHat.BOTTOM_RIGHT;
  if (down && left) return SwitchHat.BOTTOM_LEFT;
  if (up && left) return SwitchHat.TOP_LEFT;
  if (up) return SwitchHat.TOP;
  if (right) return SwitchHat.RIGHT;
  if (down) return SwitchHat.BOTTOM;
  if (left) return SwitchHat.LEFT;
  return SwitchHat.CENTER;
}

// ---------------------------------------------------------------------------
// 12-bit packed stick unpack (lab-note §5)
// ---------------------------------------------------------------------------

function unpackStick(b0: number, b1: number, b2: number): { x: number; y: number } {
  return {
    x: b0 | ((b1 & 0x0f) << 8),
    y: (b1 >> 4) | (b2 << 4),
  };
}

/**
 * Map a raw 12-bit axis to 0-255. Default (no calibration): raw linear
 * mapping `raw >> 4`. With calibration: deadzone + normalize per lab-note §6
 * procon2 formula. Clamped so the output never escapes 0-255.
 */
function axisToU8(raw: number, cal?: StickCalibration): { value: number; calibrated: boolean } {
  if (cal) {
    const dead = Math.abs(raw - cal.center) < cal.deadzone;
    if (dead) return { value: STICK_CENTER, calibrated: true };
    let normalized: number;
    if (raw > cal.center) {
      normalized = Math.min(1, (raw - cal.center) / (cal.max - cal.center));
    } else if (raw < cal.center) {
      normalized = Math.max(-1, (raw - cal.center) / (cal.center - cal.min));
    } else {
      normalized = 0;
    }
    const u8 = Math.round(((normalized + 1) / 2) * 255);
    return { value: clampStick(u8), calibrated: true };
  }
  // Uncalibrated: raw linear mapping (0..4095 -> 0..255), per S8 §4.
  return { value: clampStick(raw >> 4), calibrated: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse one NS2 Pro input report frame into a PadReport.
 *
 * Returns `null` when the frame is not a supported 0x09 report (wrong length,
 * wrong report ID) so the caller can move to the "unsupported" state and must
 * not emit anything.
 */
export function parseNs2ProReport(
  frame: Uint8Array,
  opts: Ns2ProParserOptions = {},
): ParsedNs2ProReport | null {
  let body: Uint8Array;
  if (frame.length === NS2_PRO_USB_FRAME_LEN) {
    if (frame[0] !== NS2_PRO_REPORT_ID) return null;
    body = frame.subarray(1);
  } else if (frame.length === NS2_PRO_BT_FRAME_LEN) {
    body = frame;
  } else {
    return null;
  }

  const counter = body[OFF_COUNTER] ?? 0;
  const powerInfo = body[OFF_POWER] ?? 0;

  const b0 = body[OFF_BUTTONS] ?? 0;
  const b1 = body[OFF_BUTTONS + 1] ?? 0;
  const b2 = body[OFF_BUTTONS + 2] ?? 0;

  let buttons = 0;
  for (const { mask, bit } of BTN_BYTE0) if ((b0 & mask) !== 0) buttons |= bit;
  for (const { mask, bit } of BTN_BYTE1) if ((b1 & mask) !== 0) buttons |= bit;
  for (const { mask, bit } of BTN_BYTE2) if ((b2 & mask) !== 0) buttons |= bit;

  const hat = dpadToHat(
    (b1 & DPAD_UP) !== 0,
    (b1 & DPAD_DOWN) !== 0,
    (b1 & DPAD_LEFT) !== 0,
    (b1 & DPAD_RIGHT) !== 0,
  );

  const ls = unpackStick(
    body[OFF_LEFT_STICK] ?? 0,
    body[OFF_LEFT_STICK + 1] ?? 0,
    body[OFF_LEFT_STICK + 2] ?? 0,
  );
  const rs = unpackStick(
    body[OFF_RIGHT_STICK] ?? 0,
    body[OFF_RIGHT_STICK + 1] ?? 0,
    body[OFF_RIGHT_STICK + 2] ?? 0,
  );

  const lx = axisToU8(ls.x, opts.left);
  const ly = axisToU8(ls.y, opts.left);
  const rx = axisToU8(rs.x, opts.right);
  const ry = axisToU8(rs.y, opts.right);

  const calibrated = lx.calibrated && ly.calibrated && rx.calibrated && ry.calibrated;

  return {
    report: {
      buttons,
      hat,
      lx: lx.value,
      ly: ly.value,
      rx: rx.value,
      ry: ry.value,
    },
    counter,
    powerInfo,
    battery:
      ((powerInfo >> 2) & 0x0f) <= 9 ? (powerInfo >> 2) & 0x0f : undefined,
    rawSticks: { lx: ls.x, ly: ls.y, rx: rs.x, ry: rs.y },
    calibrated,
  };
}
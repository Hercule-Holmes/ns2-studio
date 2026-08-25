import type { CaptureDeviceInfo } from "../../shared/ipc";

/**
 * HID device descriptor surface used by the capture layer. Canonical shape
 * lives in `shared/ipc.ts` (`CaptureDeviceInfo`) so main/preload/renderer
 * agree on the IPC payload; this alias keeps the HID layer's own vocabulary.
 */
export type HidDeviceInfo = CaptureDeviceInfo;

export interface HidDeviceLike {
  readonly info: HidDeviceInfo;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Write an output report (first byte is the report ID when numbered). */
  write(data: Uint8Array): Promise<void>;
  /**
   * Blocking read with timeout. Resolves `null` on timeout with no data, and
   * throws when the device is gone/closed.
   */
  read(timeoutMs: number): Promise<Uint8Array | null>;
  onClose(listener: () => void): void;
  onError(listener: (err: Error) => void): void;
}
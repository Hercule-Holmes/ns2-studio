/**
 * Minimal serial port abstraction shared by the real `serialport` wrapper
 * and the in-memory mock. Lets DeviceService unit tests run without any
 * native module.
 */
export interface SerialPortLike {
  readonly path: string;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  onData(listener: (data: Uint8Array) => void): void;
  onError(listener: (err: Error) => void): void;
  onClose(listener: () => void): void;
}
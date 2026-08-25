import { SerialPort } from "serialport";
import type { SerialPortLike } from "./types";

/**
 * Wraps `serialport` (v12, ships N-API prebuilds so it works under Electron
 * without a C++ toolchain) behind the SerialPortLike interface.
 */
export class SerialPortLayer implements SerialPortLike {
  private port: SerialPort;
  readonly path: string;

  constructor(path: string, readonly baudRate: number) {
    this.path = path;
    this.port = new SerialPort({ path, baudRate, autoOpen: false });
  }

  get isOpen(): boolean {
    return this.port.isOpen;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.open((err) => (err ? reject(err) : resolve()));
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) return resolve();
      this.port.close(() => resolve());
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()));
    });
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.port.on("data", (data: Buffer) =>
      listener(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    );
  }

  onError(listener: (err: Error) => void): void {
    this.port.on("error", listener);
  }

  onClose(listener: () => void): void {
    this.port.on("close", listener);
  }
}

export async function listSerialPorts(): Promise<string[]> {
  const ports = await SerialPort.list();
  return ports.map((p) => p.path).filter((p): p is string => Boolean(p));
}
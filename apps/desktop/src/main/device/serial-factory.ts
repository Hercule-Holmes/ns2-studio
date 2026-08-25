import type { SerialPortLike } from "./types";
import { MockSerialLayer } from "./mock-serial-layer";

export function isMockSerial(): boolean {
  return process.env.NS2_STUDIO_MOCK_SERIAL === "1";
}

/**
 * Choose between the real `serialport` backend and the in-memory mock.
 * The real backend is lazy-loaded so unit tests never touch the native
 * module unless they explicitly opt in.
 */
export async function createSerialLayer(
  path: string,
  baudRate: number,
): Promise<SerialPortLike> {
  if (isMockSerial()) {
    return new MockSerialLayer(path, baudRate);
  }
  const { SerialPortLayer } = await import("./serial-port-layer");
  return new SerialPortLayer(path, baudRate);
}

export async function listSerialPorts(): Promise<string[]> {
  if (isMockSerial()) {
    return MockSerialLayer.mockPorts();
  }
  const { listSerialPorts } = await import("./serial-port-layer");
  return listSerialPorts();
}
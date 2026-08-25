import {
  Reply,
  encodeReport,
} from "@ns2-studio/protocol";
import { NEUTRAL_REPORT } from "@ns2-studio/pad-types";
import type { SerialPortLike } from "./types";

export const MOCK_PORT_PATH = "MOCK-COM1";

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-memory serial port used when NS2_STUDIO_MOCK_SERIAL=1 so the full
 * connect flow (open -> Hello [0xA5,0x81] -> 0x80 -> Version -> reports)
 * can be demonstrated without hardware.
 */
export class MockSerialLayer implements SerialPortLike {
  static mockPorts(): string[] {
    return [MOCK_PORT_PATH];
  }

  readonly path: string;
  isOpen = false;
  /** Every frame handed to write(), for test assertions. */
  written: Uint8Array[] = [];

  private dataListeners: Array<(data: Uint8Array) => void> = [];
  private errorListeners: Array<(err: Error) => void> = [];
  private closeListeners: Array<() => void> = [];
  /** Set after acking a SaveAmiibo header; next write is the raw body. */
  private awaitingAmiiboBody = false;

  constructor(path: string, readonly baudRate: number) {
    this.path = path;
  }

  open(): Promise<void> {
    return delay(5).then(() => {
      this.isOpen = true;
      // Simulate the device pushing one RX report frame after connect.
      setTimeout(() => this.emitData(encodeReport(NEUTRAL_REPORT)), 150);
    });
  }

  close(): Promise<void> {
    return delay(5).then(() => {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.emitClose();
    });
  }

  write(data: Uint8Array): Promise<void> {
    this.written.push(Uint8Array.from(data));
    return delay(5).then(() => this.respondTo(data));
  }

  /** Feed a raw packet from "the device", e.g. an encoded report. */
  feed(packet: Uint8Array): void {
    this.emitData(packet);
  }

  onData(listener: (data: Uint8Array) => void): void {
    this.dataListeners.push(listener);
  }

  onError(listener: (err: Error) => void): void {
    this.errorListeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  private respondTo(data: Uint8Array): void {
    const bytes = Array.from(data);
    if (bytes.length >= 2 && bytes[0] === 0xa5 && bytes[1] === 0x81) {
      // Hello -> Reply.Hello (0x80)
      this.emitData(Uint8Array.from([Reply.Hello]));
      return;
    }
    if (bytes.length >= 2 && bytes[0] === 0xa5 && bytes[1] === 0x85) {
      // Version command -> ASCII version string.
      this.emitData(Uint8Array.from(Array.from("mock", (c) => c.charCodeAt(0))));
      return;
    }
    if (bytes.length >= 3 && bytes[0] === 0xa5 && bytes[2] === 0x91) {
      // ChangeAmiiboIndex -> Ack
      this.emitData(Uint8Array.from([Reply.Ack]));
      return;
    }
    if (bytes.length >= 7 && bytes[0] === 0xa5 && bytes[6] === 0x90) {
      // SaveAmiibo header -> Ack; next write is the body.
      this.awaitingAmiiboBody = true;
      this.emitData(Uint8Array.from([Reply.Ack]));
      return;
    }
    if (this.awaitingAmiiboBody && bytes.length > 0 && bytes.length <= 20) {
      // SaveAmiibo body follows the header ACK.
      this.awaitingAmiiboBody = false;
      this.emitData(Uint8Array.from([Reply.Ack]));
      return;
    }
    if (bytes.length === 1 && bytes[0] === 0xa5) {
      this.emitData(Uint8Array.from([Reply.Ack]));
    }
  }

  private emitData(data: Uint8Array): void {
    for (const listener of this.dataListeners) listener(data);
  }

  private emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }
}
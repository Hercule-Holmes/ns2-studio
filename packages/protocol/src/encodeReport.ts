import type { PadReport } from "@ns2-studio/pad-types";

export interface DecodedPacket {
  report: PadReport;
  serialized: Uint8Array;
}

export function encodeReport(report: PadReport): Uint8Array {
  const serialized = [
    (report.buttons >> 8) & 0xff,
    report.buttons & 0xff,
    report.hat & 0xff,
    report.lx & 0xff,
    report.ly & 0xff,
    report.rx & 0xff,
    report.ry & 0xff,
  ];

  const packet: number[] = [];
  let n = 0;
  let bits = 0;
  for (const b of serialized) {
    n = (n << 8) | b;
    bits += 8;
    while (bits >= 7) {
      bits -= 7;
      packet.push((n >> bits) & 0x7f);
      n &= (1 << bits) - 1;
    }
  }
  packet[packet.length - 1]! |= 0x80;
  return Uint8Array.from(packet);
}

export function decodeReportPacket(packet: Uint8Array): DecodedPacket | null {
  if (packet.length === 0) return null;
  for (let i = 0; i < packet.length - 1; i++) {
    if ((packet[i]! & 0x80) !== 0) return null;
  }

  const serialized: number[] = [];
  let n = 0;
  let bits = 0;
  for (const byte of packet) {
    n = (n << 7) | (byte & 0x7f);
    bits += 7;
    while (bits >= 8) {
      bits -= 8;
      serialized.push((n >> bits) & 0xff);
      n &= (1 << bits) - 1;
    }
  }
  if (serialized.length !== 7) return null;

  const [bh, bl, hat, lx, ly, rx, ry] = serialized as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const report: PadReport = {
    buttons: ((bh << 8) | bl) & 0xffff,
    hat,
    lx,
    ly,
    rx,
    ry,
  };
  return { report, serialized: Uint8Array.from(serialized) };
}
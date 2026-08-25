import { describe, expect, it } from "vitest";
import type { PadReport } from "@ns2-studio/pad-types";
import { decodeReportPacket, encodeReport } from "../src/index";
import vectors from "./vectors.json";

interface Vector {
  name: string;
  report: PadReport;
  hex: number[];
}

describe("encodeReport", () => {
  it("matches the verified hex vectors (C# GetBytes cross-check)", () => {
    for (const v of vectors as Vector[]) {
      const actual = encodeReport(v.report);
      expect(actual).toEqual(Uint8Array.from(v.hex));
    }
  });

  it("produces 8 bytes (56 serialized bits / 7 bits per unit)", () => {
    for (const v of vectors as Vector[]) {
      expect(encodeReport(v.report)).toHaveLength(8);
    }
  });

  it("sets bit7=1 on the final byte only (end flag)", () => {
    for (const v of vectors as Vector[]) {
      const packet = encodeReport(v.report);
      expect(packet[packet.length - 1]! & 0x80).not.toBe(0);
      for (let i = 0; i < packet.length - 1; i++) {
        expect(packet[i]! & 0x80).toBe(0);
      }
    }
  });
});

describe("decodeReportPacket", () => {
  it("round-trips every vector back to its report", () => {
    for (const v of vectors as Vector[]) {
      const packet = encodeReport(v.report);
      const decoded = decodeReportPacket(packet);
      expect(decoded).not.toBeNull();
      expect(decoded!.report).toEqual(v.report);
    }
  });

  it("rejects packets with a set end flag before the last byte", () => {
    expect(decodeReportPacket(Uint8Array.from([0x80, 0x00]))).toBeNull();
  });

  it("rejects an empty packet", () => {
    expect(decodeReportPacket(Uint8Array.from([]))).toBeNull();
  });
});
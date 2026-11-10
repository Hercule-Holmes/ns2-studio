import { describe, expect, it } from "vitest";
import {
  PacketError,
  decodeMessage,
  encodeName,
  encodeQuery,
} from "../src/main/netaccel/dns-packet";

describe("dns-packet (S21)", () => {
  it("roundtrips a query", () => {
    const q = encodeQuery(0x1234, "atum.hac.lp1.d4c.nintendo.net");
    const msg = decodeMessage(q);
    expect(msg.id).toBe(0x1234);
    expect(msg.qr).toBe(false);
    expect(msg.questions).toHaveLength(1);
    expect(msg.questions[0]!.name).toBe("atum.hac.lp1.d4c.nintendo.net");
    expect(msg.questions[0]!.type).toBe(1);
    expect(msg.questions[0]!.klass).toBe(1);
  });

  it("decodes compressed names in answers (pointer into question)", () => {
    // Handcraft: header + question "a.b" + answer whose name is a pointer to
    // offset 12 (0xc00c), the standard form real resolvers emit.
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0x0001, 0); // id
    header.writeUInt16BE(0x8180, 2); // QR|RA|RD
    header.writeUInt16BE(1, 4); // qd
    header.writeUInt16BE(1, 6); // an
    const question = encodeName("a.b.example.com");
    const qtail = Buffer.from([0, 1, 0, 1]); // A IN
    const answer = Buffer.concat([
      Buffer.from([0xc0, 12]), // pointer to question name
      Buffer.from([0, 1, 0, 1]),
      Buffer.from([0, 0, 0, 60]), // ttl
      Buffer.from([0, 4]),
      Buffer.from([9, 8, 7, 6]),
    ]);
    const msg = Buffer.concat([header, question, qtail, answer]);
    const parsed = decodeMessage(msg);
    expect(parsed.answers[0]!.name).toBe("a.b.example.com");
    expect(parsed.answers[0]!.ipv4).toBe("9.8.7.6");
  });

  it("rejects malformed packets with PacketError", () => {
    expect(() => decodeMessage(Buffer.alloc(4))).toThrow(PacketError);
    expect(() => encodeName("a..b")).toThrow(PacketError);
  });
});

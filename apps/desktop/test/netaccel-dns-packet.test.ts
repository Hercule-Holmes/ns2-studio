import { describe, expect, it } from "vitest";
import {
  PacketError,
  decodeMessage,
  encodeName,
  encodeQuery,
  encodeResponse,
  ipToBuffer,
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

  it("reuses the raw question bytes when synthesizing an answer", () => {
    const q = encodeQuery(0xbeef, "example.com");
    const decoded = decodeMessage(q);
    const reply = encodeResponse(decoded, [
      { name: "example.com", type: 1, ttl: 60, ipv4: "1.2.3.4" },
    ]);
    const back = decodeMessage(reply);
    expect(back.id).toBe(0xbeef);
    expect(back.qr).toBe(true);
    expect(back.rcode).toBe(0);
    expect(back.questions[0]!.name).toBe("example.com");
    expect(back.answers).toHaveLength(1);
    expect(back.answers[0]!.ipv4).toBe("1.2.3.4");
    expect(back.answers[0]!.ttl).toBe(60);
    // question bytes must be byte-identical (copied verbatim)
    const qBytes = q.subarray(12).toString("hex");
    const rBytes = reply.subarray(12, 12 + qBytes.length / 2).toString("hex");
    expect(rBytes).toBe(qBytes);
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
      ipToBuffer("9.8.7.6"),
    ]);
    const msg = Buffer.concat([header, question, qtail, answer]);
    const parsed = decodeMessage(msg);
    expect(parsed.answers[0]!.name).toBe("a.b.example.com");
    expect(parsed.answers[0]!.ipv4).toBe("9.8.7.6");
  });

  it("rejects malformed packets with PacketError", () => {
    expect(() => decodeMessage(Buffer.alloc(4))).toThrow(PacketError);
    expect(() => encodeName("a..b")).toThrow(PacketError);
    expect(() => ipToBuffer("1.2.3")).toThrow(PacketError);
    expect(() => ipToBuffer("1.2.3.999")).toThrow(PacketError);
  });

  it("synthesizes NXDOMAIN-style rcodes", () => {
    const q = decodeMessage(encodeQuery(1, "x.test"));
    const reply = decodeMessage(encodeResponse(q, [], 3));
    expect(reply.rcode).toBe(3);
    expect(reply.answers).toHaveLength(0);
  });
});

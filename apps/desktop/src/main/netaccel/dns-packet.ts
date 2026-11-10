/**
 * S21: minimal DNS wire-format codec (RFC 1035) for the netaccel DNS server
 * and its UDP resolver client. Deliberately tiny — we only ever need to
 * synthesize/parse A-record queries and answers, never AXFR/SIG/OPT.
 * Pure functions; no sockets, fully unit-testable.
 */

const DNS_TYPE_A = 1;
const DNS_CLASS_IN = 1;

export class PacketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PacketError";
  }
}

/** "atum.hac.lp1.d4c.nintendo.net" → wire labels (no compression). */
export function encodeName(name: string): Buffer {
  const clean = name.replace(/\.$/, "");
  if (!clean) throw new PacketError("empty name");
  const parts: Buffer[] = [];
  let total = 1; // trailing root label
  for (const label of clean.split(".")) {
    const bytes = Buffer.from(label, "ascii");
    if (label.length === 0) throw new PacketError(`empty label in ${name}`);
    if (label.length > 63) throw new PacketError(`label >63 in ${name}`);
    if (bytes.length !== label.length) throw new PacketError(`non-ascii label in ${name}`);
    total += 1 + bytes.length;
    if (total > 255) throw new PacketError(`name >255: ${name}`);
    parts.push(Buffer.concat([Buffer.from([label.length]), bytes]));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Decode a (possibly compressed) name at `offset`.
 * Returns the FQDN (without trailing dot) and the offset of the first byte
 * *after* the name in the original stream (jump targets do not advance it).
 */
function decodeName(
  buf: Buffer,
  offset: number,
): { name: string; next: number } {
  const labels: string[] = [];
  let next = -1;
  let jumps = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buf.length) throw new PacketError("name runs past end");
    const len = buf[pos]!;
    if (len === 0) {
      if (next < 0) next = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      // Compression pointer: lower 14 bits point elsewhere in the message.
      if (pos + 1 >= buf.length) throw new PacketError("truncated pointer");
      if (next < 0) next = pos + 2;
      jumps += 1;
      if (jumps > 32) throw new PacketError("compression pointer loop");
      const target = ((len & 0x3f) << 8) | buf[pos + 1]!;
      if (target >= pos) throw new PacketError("forward compression pointer");
      pos = target;
      continue;
    }
    if ((len & 0xc0) !== 0 || pos + 1 + len > buf.length) {
      throw new PacketError("bad label length");
    }
    labels.push(buf.toString("ascii", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.join("."), next };
}

export interface DnsQuestion {
  name: string;
  type: number;
  klass: number;
  /** Raw question-section bytes (name+type+class), reused verbatim when we synthesize an answer. */
  raw: Buffer;
}

export interface DnsAnswer {
  name: string;
  type: number;
  klass: number;
  ttl: number;
  /** A record → dotted IPv4; other types → null (type/ttl still parsed). */
  ipv4?: string;
}

export interface DnsMessage {
  id: number;
  qr: boolean;
  rcode: number;
  questions: DnsQuestion[];
  answers: DnsAnswer[];
}

function readU16(buf: Buffer, off: number): number {
  return (buf[off]! << 8) | buf[off + 1]!;
}

function readU32(buf: Buffer, off: number): number {
  return ((buf[off]! << 24) | (buf[off + 1]! << 16) | (buf[off + 2]! << 8) | buf[off + 3]!) >>> 0;
}

/** Parse header + question + answer sections; authority/additional are ignored. */
export function decodeMessage(buf: Buffer): DnsMessage {
  if (buf.length < 12) throw new PacketError("short header");
  const id = readU16(buf, 0);
  const flags = readU16(buf, 2);
  const qdcount = readU16(buf, 4);
  const ancount = readU16(buf, 6);

  const questions: DnsQuestion[] = [];
  let pos = 12;
  for (let i = 0; i < qdcount; i += 1) {
    const qStart = pos;
    const { name, next } = decodeName(buf, pos);
    if (next + 4 > buf.length) throw new PacketError("truncated question");
    questions.push({
      name,
      type: readU16(buf, next),
      klass: readU16(buf, next + 2),
      raw: buf.subarray(qStart, next + 4),
    });
    pos = next + 4;
  }

  const answers: DnsAnswer[] = [];
  for (let i = 0; i < ancount; i += 1) {
    const { name, next } = decodeName(buf, pos);
    if (next + 10 > buf.length) throw new PacketError("truncated answer");
    const type = readU16(buf, next);
    const klass = readU16(buf, next + 2);
    const ttl = readU32(buf, next + 4);
    const rdlength = readU16(buf, next + 8);
    const rdStart = next + 10;
    if (rdStart + rdlength > buf.length) throw new PacketError("rdata past end");
    const answer: DnsAnswer = { name, type, klass, ttl };
    if (type === DNS_TYPE_A && rdlength === 4) {
      answer.ipv4 = `${buf[rdStart]}.${buf[rdStart + 1]}.${buf[rdStart + 2]}.${buf[rdStart + 3]}`;
    }
    answers.push(answer);
    pos = rdStart + rdlength;
  }

  return {
    id,
    qr: (flags & 0x8000) !== 0,
    rcode: flags & 0x000f,
    questions,
    answers,
  };
}

function putU16(buf: Buffer, off: number, v: number): void {
  buf[off] = (v >> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}

export function encodeQuery(
  id: number,
  name: string,
  opts: { type?: number; recursionDesired?: boolean } = {},
): Buffer {
  const qname = encodeName(name);
  const buf = Buffer.alloc(12 + qname.length + 4);
  putU16(buf, 0, id & 0xffff);
  putU16(buf, 2, opts.recursionDesired === false ? 0x0000 : 0x0100); // RD=1 default
  putU16(buf, 4, 1); // QDCOUNT
  qname.copy(buf, 12);
  putU16(buf, 12 + qname.length, opts.type ?? DNS_TYPE_A);
  putU16(buf, 12 + qname.length + 2, DNS_CLASS_IN);
  return buf;
}

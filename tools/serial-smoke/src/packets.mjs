export const NEUTRAL_REPORT = Object.freeze([0x00, 0x00, 0x01, 0x08, 0x04, 0x02, 0x01, 0x80]);
export const A_PRESS_REPORT = Object.freeze([0x00, 0x01, 0x01, 0x08, 0x04, 0x02, 0x01, 0x80]);
export const STICK_UP_REPORT = Object.freeze([0x00, 0x00, 0x01, 0x08, 0x00, 0x02, 0x01, 0x80]);

export const HELLO_COMMAND = Object.freeze([0xa5, 0x81]);
export const REPLY_HELLO = 0x80;

export function pack7Bit(serialized) {
  let n = 0;
  let bits = 0;
  const packet = [];
  for (const b of serialized) {
    n = (n << 8) | b;
    bits += 8;
    while (bits >= 7) {
      bits -= 7;
      packet.push((n >> bits) & 0x7f);
      n &= (1 << bits) - 1;
    }
  }
  packet[packet.length - 1] |= 0x80;
  return packet;
}

export function bytesToHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}
/**
 * RFC 9562 UUID v7 generator.
 * Layout:
 *   bytes 0-5  (48 bits) — Unix epoch milliseconds, big-endian
 *   byte 6     (high nibble) — version 7 (0x70)
 *   byte 6     (low nibble) + byte 7 — 12 random bits
 *   byte 8     (high 2 bits) — variant 10
 *   byte 8     (low 6 bits) + bytes 9-15 — 62 random bits
 */
export const uuidV7 = (): string => {
  const ts = Date.now();
  const buf = new Uint8Array(16);

  buf[0] = Math.floor(ts / 0x10000000000) & 0xff;
  buf[1] = Math.floor(ts / 0x100000000) & 0xff;
  buf[2] = Math.floor(ts / 0x1000000) & 0xff;
  buf[3] = Math.floor(ts / 0x10000) & 0xff;
  buf[4] = Math.floor(ts / 0x100) & 0xff;
  buf[5] = ts & 0xff;

  fillRandom(buf.subarray(6));

  buf[6] = (buf[6]! & 0x0f) | 0x70; // version 7
  buf[8] = (buf[8]! & 0x3f) | 0x80; // variant 10xx

  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20, 32)
  );
};

const fillRandom = (buf: Uint8Array): void => {
  // Prefer crypto.getRandomValues (Hermes 0.74+, browsers, Node, Bun).
  // RN apps targeting older Hermes should add `react-native-get-random-values`
  // before importing the SDK.
  const cryptoObj = (
    globalThis as {
      crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(buf);
    return;
  }
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.floor(Math.random() * 256);
  }
};

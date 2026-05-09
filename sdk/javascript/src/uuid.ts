/**
 * uuid v7 (timestamp-prefixed). Modern Node ≥ 19 + browsers expose
 * `crypto.randomUUID()` for v4 — that gives us the entropy half;
 * v7 layout is cheap to assemble manually.
 *
 * Layout (RFC 9562 v7):
 *   ms (48 bits) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 */
export function uuidV7(): string {
  const ms = Date.now()
  const rand = new Uint8Array(10)
  cryptoRandomFill(rand)

  // 6 bytes of timestamp (ms), big-endian
  const t = new Uint8Array(6)
  let n = ms
  for (let i = 5; i >= 0; i--) {
    t[i] = n & 0xff
    n = Math.floor(n / 256)
  }

  // pack version + variant
  rand[0] = (rand[0]! & 0x0f) | 0x70 // version 7 in high nibble of byte 6
  rand[2] = (rand[2]! & 0x3f) | 0x80 // variant 10 in high two bits of byte 8

  const bytes = new Uint8Array(16)
  bytes.set(t, 0)
  bytes.set(rand, 6)

  return (
    hex(bytes.subarray(0, 4)) +
    '-' +
    hex(bytes.subarray(4, 6)) +
    '-' +
    hex(bytes.subarray(6, 8)) +
    '-' +
    hex(bytes.subarray(8, 10)) +
    '-' +
    hex(bytes.subarray(10, 16))
  )
}

function cryptoRandomFill(buf: Uint8Array): void {
  // Browser + Node 19+ + Bun all expose globalThis.crypto.
  const c = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto
  if (c?.getRandomValues) {
    c.getRandomValues(buf)
    return
  }
  // Last-resort Math.random (only hits in very old envs; entropy
  // quality is bad but we still want a unique-ish id).
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
}

function hex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

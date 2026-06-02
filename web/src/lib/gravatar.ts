/** Gravatar URL for a given email — md5 hash of the lower-case
 *  trimmed email, 200px, identicon fallback. */
export function gravatarFor(email: string): string {
  const hash = md5(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=200&d=identicon`
}

// Minimal MD5 (used only for gravatar URL — not for crypto).
function md5(input: string): string {
  // Tiny in-tree MD5 to avoid an extra dep. Sourced from the public-
  // domain reference in RFC 1321; reformatted for TypeScript.
  const safeAdd = (x: number, y: number): number => {
    const lsw = (x & 0xffff) + (y & 0xffff)
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16)
    return (msw << 16) | (lsw & 0xffff)
  }
  const rotateLeft = (n: number, s: number): number => (n << s) | (n >>> (32 - s))
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number): number =>
    safeAdd(rotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b)
  const ff = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn((b & c) | (~b & d), a, b, x, s, t)
  const gg = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn((b & d) | (c & ~d), a, b, x, s, t)
  const hh = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn(b ^ c ^ d, a, b, x, s, t)
  const ii = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn(c ^ (b | ~d), a, b, x, s, t)
  const bytes = new TextEncoder().encode(input)
  const len = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, len, true)
  const words = new Int32Array(padded.length / 4)
  for (let i = 0; i < words.length; i++) words[i] = view.getInt32(i * 4, true)
  let a = 0x67452301
  let b = -0x10325477
  let c = -0x67452302
  let d = 0x10325476
  for (let i = 0; i < words.length; i += 16) {
    const olda = a
    const oldb = b
    const oldc = c
    const oldd = d
    a = ff(a, b, c, d, words[i]!, 7, -0x28955b88)
    d = ff(d, a, b, c, words[i + 1]!, 12, -0x173848aa)
    c = ff(c, d, a, b, words[i + 2]!, 17, 0x242070db)
    b = ff(b, c, d, a, words[i + 3]!, 22, -0x3e423112)
    a = ff(a, b, c, d, words[i + 4]!, 7, -0xa83f051)
    d = ff(d, a, b, c, words[i + 5]!, 12, 0x4787c62a)
    c = ff(c, d, a, b, words[i + 6]!, 17, -0x57cfb9ed)
    b = ff(b, c, d, a, words[i + 7]!, 22, -0x2b96aff)
    a = ff(a, b, c, d, words[i + 8]!, 7, 0x698098d8)
    d = ff(d, a, b, c, words[i + 9]!, 12, -0x74bb0851)
    c = ff(c, d, a, b, words[i + 10]!, 17, -0xa44f)
    b = ff(b, c, d, a, words[i + 11]!, 22, -0x76a32842)
    a = ff(a, b, c, d, words[i + 12]!, 7, 0x6b901122)
    d = ff(d, a, b, c, words[i + 13]!, 12, -0x2678e6d)
    c = ff(c, d, a, b, words[i + 14]!, 17, -0x5986bc72)
    b = ff(b, c, d, a, words[i + 15]!, 22, 0x49b40821)
    a = gg(a, b, c, d, words[i + 1]!, 5, -0x9e1da9e)
    d = gg(d, a, b, c, words[i + 6]!, 9, -0x3fbf4cc0)
    c = gg(c, d, a, b, words[i + 11]!, 14, 0x265e5a51)
    b = gg(b, c, d, a, words[i]!, 20, -0x16493856)
    a = gg(a, b, c, d, words[i + 5]!, 5, -0x29d0efa3)
    d = gg(d, a, b, c, words[i + 10]!, 9, 0x2441453)
    c = gg(c, d, a, b, words[i + 15]!, 14, -0x275e197f)
    b = gg(b, c, d, a, words[i + 4]!, 20, -0x182c0438)
    a = gg(a, b, c, d, words[i + 9]!, 5, 0x21e1cde6)
    d = gg(d, a, b, c, words[i + 14]!, 9, -0x3cc8f82a)
    c = gg(c, d, a, b, words[i + 3]!, 14, -0xb2af279)
    b = gg(b, c, d, a, words[i + 8]!, 20, 0x455a14ed)
    a = gg(a, b, c, d, words[i + 13]!, 5, -0x561c16fb)
    d = gg(d, a, b, c, words[i + 2]!, 9, -0x3105c08)
    c = gg(c, d, a, b, words[i + 7]!, 14, 0x676f02d9)
    b = gg(b, c, d, a, words[i + 12]!, 20, -0x72d5b376)
    a = hh(a, b, c, d, words[i + 5]!, 4, -0x5c6be)
    d = hh(d, a, b, c, words[i + 8]!, 11, -0x788e097f)
    c = hh(c, d, a, b, words[i + 11]!, 16, 0x6d9d6122)
    b = hh(b, c, d, a, words[i + 14]!, 23, -0x21ac7f4)
    a = hh(a, b, c, d, words[i + 1]!, 4, -0x5b4115bc)
    d = hh(d, a, b, c, words[i + 4]!, 11, 0x4bdecfa9)
    c = hh(c, d, a, b, words[i + 7]!, 16, -0x944b4a0)
    b = hh(b, c, d, a, words[i + 10]!, 23, -0x41404390)
    a = hh(a, b, c, d, words[i + 13]!, 4, 0x289b7ec6)
    d = hh(d, a, b, c, words[i]!, 11, -0x155ed806)
    c = hh(c, d, a, b, words[i + 3]!, 16, -0x2b10cf7b)
    b = hh(b, c, d, a, words[i + 6]!, 23, 0x4881d05)
    a = hh(a, b, c, d, words[i + 9]!, 4, -0x262b2fc7)
    d = hh(d, a, b, c, words[i + 12]!, 11, -0x1924661b)
    c = hh(c, d, a, b, words[i + 15]!, 16, 0x1fa27cf8)
    b = hh(b, c, d, a, words[i + 2]!, 23, -0x3b53a99b)
    a = ii(a, b, c, d, words[i]!, 6, -0xbd6ddbc)
    d = ii(d, a, b, c, words[i + 7]!, 10, 0x432aff97)
    c = ii(c, d, a, b, words[i + 14]!, 15, -0x546bdc59)
    b = ii(b, c, d, a, words[i + 5]!, 21, -0x36c5fc7)
    a = ii(a, b, c, d, words[i + 12]!, 6, 0x655b59c3)
    d = ii(d, a, b, c, words[i + 3]!, 10, -0x70f3336e)
    c = ii(c, d, a, b, words[i + 10]!, 15, -0x100b83)
    b = ii(b, c, d, a, words[i + 1]!, 21, -0x7a7ba22f)
    a = ii(a, b, c, d, words[i + 8]!, 6, 0x6fa87e4f)
    d = ii(d, a, b, c, words[i + 15]!, 10, -0x1d31920)
    c = ii(c, d, a, b, words[i + 6]!, 15, -0x5cfebcec)
    b = ii(b, c, d, a, words[i + 13]!, 21, 0x4e0811a1)
    a = ii(a, b, c, d, words[i + 4]!, 6, -0x8ac817e)
    d = ii(d, a, b, c, words[i + 11]!, 10, -0x42c50dcb)
    c = ii(c, d, a, b, words[i + 2]!, 15, 0x2ad7d2bb)
    b = ii(b, c, d, a, words[i + 9]!, 21, -0x14792c6f)
    a = safeAdd(a, olda)
    b = safeAdd(b, oldb)
    c = safeAdd(c, oldc)
    d = safeAdd(d, oldd)
  }
  const toHex = (n: number) =>
    Array.from({ length: 4 }, (_, j) => ((n >> (j * 8)) & 0xff).toString(16).padStart(2, '0')).join(
      ''
    )
  return toHex(a) + toHex(b) + toHex(c) + toHex(d)
}

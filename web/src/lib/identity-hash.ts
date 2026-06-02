/**
 * Browser-side identity hashing — mirrors `sdk/core/src/identity.ts`'s
 * normalization + SHA-256 so the dashboard's "look up by email"
 * input produces the same `client_hash` the SDK does at ingest.
 *
 * Raw value never leaves the browser:
 *   - operator types email → this module hashes → server gets hash
 *   - URL state carries hash only (no raw)
 *   - dashboard React state clears raw value as soon as the hash is computed
 *
 * If `crypto.subtle` is unavailable (very old browser), the
 * function rejects — there is NO insecure fallback.
 */

export type IdentityKeyType =
  | 'email'
  | 'phone'
  | 'googleSub'
  | 'appleSub'
  | 'metaSub'
  | 'username'
  | string

function normalize(keyType: IdentityKeyType, raw: string): string {
  switch (keyType) {
    case 'email':
      return raw.trim().toLowerCase()
    case 'phone':
      return raw.replace(/[^+\d]/g, '')
    case 'username':
      return raw.trim().toLowerCase()
    case 'googleSub':
    case 'appleSub':
    case 'metaSub':
      return raw
    default:
      return raw.trim()
  }
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    const h = bytes[i]!.toString(16)
    out += h.length === 1 ? '0' + h : h
  }
  return out
}

export async function hashIdentity(keyType: IdentityKeyType, raw: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('sentori: crypto.subtle unavailable — identity lookup requires WebCrypto')
  }
  const normalized = normalize(keyType, raw)
  if (normalized === '') {
    throw new Error('sentori: identity value is empty after normalization')
  }
  const enc = new TextEncoder()
  const buf = await subtle.digest('SHA-256', enc.encode(normalized))
  return bufferToHex(buf)
}

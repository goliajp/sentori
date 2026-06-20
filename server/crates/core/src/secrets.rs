// v2.7 W1 — application-level secret encryption.
//
// The push subsystem stores APNs / FCM / VAPID / HCM / MiPush
// credentials in a `push_credentials` row whose `secret_blob` column
// is the AES-256-GCM ciphertext of the provider-specific payload
// (PEM-encoded EC private key for APNs, service-account JSON for FCM,
// etc.). This module owns the seal / open primitives.
//
// Key derivation: the master key is the HKDF-SHA256 expansion of
// `SENTORI_SESSION_SECRET` with info string `"sentori-secrets-v1"`.
// The info string is the version selector — bumping it (and double-
// writing rows during the transition) is the rotation path. Today
// there is only one version.
//
// Cipher: AES-256-GCM, 12-byte random nonce per row, 16-byte tag.
// The (ciphertext, nonce) pair is stored across `secret_blob` and
// `secret_nonce` columns. Tag is appended to the ciphertext by the
// aes-gcm crate (RFC 5116 packing).
//
// Why AES-GCM over ChaCha20-Poly1305: every prod CPU has AES-NI;
// throughput is irrelevant at the row-rate Sentori operates on but
// AES is the FIPS-blessed choice if a customer ever asks. Pure-Rust
// `aes-gcm` crate, no OpenSSL dependency.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use thiserror::Error;

const HKDF_INFO: &[u8] = b"sentori-secrets-v1";

#[derive(Debug, Error)]
pub enum SealError {
    #[error("master secret too short or malformed")]
    InvalidMasterKey,
    #[error("encryption failed")]
    EncryptFailed,
    #[error("decryption failed (wrong key, ciphertext tampering, or nonce mismatch)")]
    DecryptFailed,
    #[error("nonce length must be exactly 12 bytes, got {0}")]
    NonceLength(usize),
}

/// Encrypt `plaintext` under the master key. Returns `(ciphertext, nonce)`.
/// Caller persists both — the nonce is non-secret but mandatory for
/// decryption.
pub fn seal(master_secret: &[u8], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), SealError> {
    let key = derive_key(master_secret)?;
    let cipher = Aes256Gcm::new(&key);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| SealError::EncryptFailed)?;
    Ok((ct, nonce_bytes.to_vec()))
}

/// Decrypt a previously sealed ciphertext + nonce. Fails on the same
/// `SealError::DecryptFailed` for any rejection (wrong key, tag
/// mismatch, truncation) — the GCM auth tag covers all three.
pub fn open(master_secret: &[u8], ciphertext: &[u8], nonce: &[u8]) -> Result<Vec<u8>, SealError> {
    if nonce.len() != 12 {
        return Err(SealError::NonceLength(nonce.len()));
    }
    let key = derive_key(master_secret)?;
    let cipher = Aes256Gcm::new(&key);
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| SealError::DecryptFailed)
}

fn derive_key(master_secret: &[u8]) -> Result<Key<Aes256Gcm>, SealError> {
    if master_secret.is_empty() {
        return Err(SealError::InvalidMasterKey);
    }
    let hk = Hkdf::<Sha256>::new(None, master_secret);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm)
        .map_err(|_| SealError::InvalidMasterKey)?;
    Ok(*Key::<Aes256Gcm>::from_slice(&okm))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MASTER: &[u8] = b"a-test-master-secret-that-is-long-enough-32+";

    #[test]
    fn seal_and_open_roundtrip() {
        let plaintext = b"-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----";
        let (ct, nonce) = seal(MASTER, plaintext).expect("seal ok");
        assert_ne!(ct.as_slice(), plaintext);
        assert_eq!(nonce.len(), 12);
        let recovered = open(MASTER, &ct, &nonce).expect("open ok");
        assert_eq!(recovered.as_slice(), plaintext);
    }

    #[test]
    fn open_rejects_wrong_key() {
        let plaintext = b"hello world";
        let (ct, nonce) = seal(MASTER, plaintext).expect("seal ok");
        let other_master = b"a-different-secret-that-does-not-match-xyz";
        let err = open(other_master, &ct, &nonce).unwrap_err();
        assert!(matches!(err, SealError::DecryptFailed));
    }

    #[test]
    fn open_rejects_tampered_ciphertext() {
        let plaintext = b"hello world";
        let (mut ct, nonce) = seal(MASTER, plaintext).expect("seal ok");
        ct[0] ^= 0x01;
        let err = open(MASTER, &ct, &nonce).unwrap_err();
        assert!(matches!(err, SealError::DecryptFailed));
    }

    #[test]
    fn open_rejects_wrong_nonce_length() {
        let plaintext = b"hello world";
        let (ct, _nonce) = seal(MASTER, plaintext).expect("seal ok");
        let short_nonce = [0u8; 8];
        let err = open(MASTER, &ct, &short_nonce).unwrap_err();
        assert!(matches!(err, SealError::NonceLength(8)));
    }

    #[test]
    fn distinct_seals_produce_distinct_ciphertexts() {
        let plaintext = b"deterministic input";
        let (ct1, n1) = seal(MASTER, plaintext).expect("seal 1 ok");
        let (ct2, n2) = seal(MASTER, plaintext).expect("seal 2 ok");
        assert_ne!(n1, n2, "nonces must be random per seal");
        assert_ne!(ct1, ct2, "ciphertexts differ when nonces differ");
        // Both still decrypt to the same plaintext.
        assert_eq!(open(MASTER, &ct1, &n1).unwrap(), plaintext);
        assert_eq!(open(MASTER, &ct2, &n2).unwrap(), plaintext);
    }

    #[test]
    fn empty_master_rejected() {
        let err = seal(b"", b"x").unwrap_err();
        assert!(matches!(err, SealError::InvalidMasterKey));
    }
}

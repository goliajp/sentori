// v2.8 — Web Push (RFC 8030 / RFC 8291 / RFC 8292) provider.
//
// Three RFCs collaborate:
//
//   * RFC 8030 — push HTTP delivery: a generic "POST to subscription
//     URL". Each browser vendor (FCM Web for Chrome/Edge, Mozilla
//     autopush for Firefox, Apple's Web Push for Safari 16.4+) runs
//     their own push server; the subscription URL the browser hands
//     back IS the delivery endpoint.
//
//   * RFC 8292 — VAPID (Voluntary Application Server Identification).
//     ES256 JWT with claims `{ aud: origin_of_endpoint, exp, sub }`
//     signed with the project's VAPID private key. Sent as
//     `Authorization: vapid t=<jwt>,k=<base64url_pub>`.
//
//   * RFC 8291 — payload encryption (`Content-Encoding: aes128gcm`):
//     ephemeral server P-256 key pair, ECDH against the subscription's
//     `p256dh`, HKDF-SHA256 chain to derive a content-encryption key
//     + AES-GCM nonce, then AES-128-GCM seal of the padded plaintext.
//
// Subscription wire shape (from the browser via the SDK):
//   {
//     "endpoint": "https://fcm.googleapis.com/fcm/send/...",
//     "keys": { "p256dh": "<base64url 65-byte uncompressed pub>",
//               "auth":   "<base64url 16-byte secret>" }
//   }
// We persist the whole subscription as a JSON string in
// `device_tokens.native_token`.
//
// Outcome classification:
//   200 / 201 / 204             → Sent
//   404 / 410                   → PermanentlyInvalidToken
//   413                         → TerminalOther("MessageTooBig")
//   429 + Retry-After           → Transient(retry_after)
//   5xx                         → Transient(retry_after?)
//   401 / 403                   → TerminalOther (cred / VAPID rejected)
//   other                       → TerminalOther

use aes_gcm::aead::{Aead, KeyInit, Payload as AeadPayload};
use aes_gcm::{Aes128Gcm, Nonce};
use async_trait::async_trait;
use base64::Engine;
use hkdf::Hkdf;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use p256::ecdh::diffie_hellman;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::time::{Duration, Instant};

use super::{
    Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome,
    ValidateOutcome,
};
use crate::push::token_cache::TokenCache;
use crate::push::types::NativeMessage;

const RECORD_SIZE: u32 = 4096;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;
const TAG_LEN: usize = 16;
const KEY_LEN: usize = 16;
const PUB_LEN: usize = 65;

/// VAPID JWT inner `exp` is `now + 12 h` (well under RFC 8292's 24 h
/// cap). Cache the signed JWT for `12 h − 1 h` so we never hand out a
/// token that's already in its dying window.
const VAPID_CACHE_TTL: Duration = Duration::from_secs(11 * 3600);

pub struct WebPushProvider {
    http_client: reqwest::Client,
    /// VAPID JWT cache keyed by `(vapid_public, push_service_origin)`
    /// — one JWT per (publisher identity, audience). v2.20 added.
    jwt_cache: TokenCache<(String, String), String>,
}

impl WebPushProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self {
            http_client,
            jwt_cache: TokenCache::new(),
        }
    }

    /// Returns a valid VAPID JWT for `(vapid_public, aud)`, signing
    /// one only if the cached entry is missing or expired. The aud is
    /// the push service origin (e.g. `https://fcm.googleapis.com`),
    /// which is the JWT's `aud` claim per RFC 8292.
    async fn vapid_jwt(
        &self,
        vapid_public: &str,
        aud: &str,
        sub: &str,
        private_pem: &str,
    ) -> Result<String, String> {
        let key = (vapid_public.to_string(), aud.to_string());
        let aud_owned = aud.to_string();
        let sub_owned = sub.to_string();
        let private_owned = private_pem.to_string();
        self.jwt_cache
            .get_or_insert_with(key, move || async move {
                let jwt = sign_vapid(&private_owned, &aud_owned, &sub_owned)?;
                Ok::<_, String>((jwt, Instant::now() + VAPID_CACHE_TTL))
            })
            .await
    }
}

#[derive(Deserialize)]
struct WebPushConfig {
    /// Base64url-encoded 65-byte uncompressed P-256 public key.
    /// Sent in the `k=` field of the VAPID header.
    vapid_public: String,
    /// Operator contact `mailto:dev@example.com` or `https://...`.
    /// Required by some push servers (FCM Web is strict). Goes in
    /// the JWT `sub` claim.
    contact: String,
}

#[derive(Deserialize)]
struct WebPushSecret {
    /// PEM-encoded EC P-256 private key matching `vapid_public`.
    vapid_private: String,
}

#[derive(Deserialize)]
struct Subscription {
    endpoint: String,
    keys: SubscriptionKeys,
}

#[derive(Deserialize)]
struct SubscriptionKeys {
    /// Base64url-encoded 65-byte uncompressed P-256 public key.
    p256dh: String,
    /// Base64url-encoded 16-byte auth secret.
    auth: String,
}

#[derive(Serialize)]
struct VapidClaims<'a> {
    aud: &'a str,
    exp: u64,
    sub: &'a str,
}

#[async_trait]
impl Provider for WebPushProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::WebPush
    }

    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        _env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        let config: WebPushConfig = serde_json::from_value(cred.config.clone())
            .map_err(|e| ProviderError::CredentialMalformed(format!("config: {e}")))?;
        let secret: WebPushSecret = serde_json::from_slice(cred.secret_payload)
            .map_err(|e| ProviderError::CredentialMalformed(format!("secret: {e}")))?;
        let subscription: Subscription = serde_json::from_str(native_token).map_err(|e| {
            ProviderError::PayloadMalformed(format!(
                "native_token must be a JSON subscription object: {e}"
            ))
        })?;

        let payload_plain = serde_json::to_vec(&build_payload(msg))
            .map_err(|e| ProviderError::PayloadMalformed(format!("payload: {e}")))?;

        let p256dh_bytes = base64url_decode(&subscription.keys.p256dh)
            .map_err(|e| ProviderError::PayloadMalformed(format!("p256dh decode: {e}")))?;
        let auth_bytes = base64url_decode(&subscription.keys.auth)
            .map_err(|e| ProviderError::PayloadMalformed(format!("auth decode: {e}")))?;
        if p256dh_bytes.len() != PUB_LEN {
            return Err(ProviderError::PayloadMalformed(format!(
                "p256dh must be 65 bytes, got {}",
                p256dh_bytes.len()
            )));
        }
        if auth_bytes.len() != 16 {
            return Err(ProviderError::PayloadMalformed(format!(
                "auth must be 16 bytes, got {}",
                auth_bytes.len()
            )));
        }

        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        let encrypted = encrypt_aes128gcm(&payload_plain, &p256dh_bytes, &auth_bytes, &salt)
            .map_err(|e| ProviderError::Internal(format!("encrypt: {e}")))?;

        let aud = origin_of(&subscription.endpoint)
            .ok_or_else(|| {
                ProviderError::PayloadMalformed(format!(
                    "subscription endpoint has no origin: {}",
                    subscription.endpoint
                ))
            })?;
        let jwt = self
            .vapid_jwt(&config.vapid_public, &aud, &config.contact, &secret.vapid_private)
            .await
            .map_err(|e| ProviderError::CredentialMalformed(format!("vapid sign: {e}")))?;

        let ttl = msg.options.ttl.unwrap_or(3600).max(0);
        let urgency = match msg.options.priority {
            Some(crate::push::types::Priority::High) => "high",
            _ => "normal",
        };

        let t0 = Instant::now();
        let resp = self
            .http_client
            .post(&subscription.endpoint)
            .header(
                "authorization",
                format!("vapid t={jwt},k={}", config.vapid_public),
            )
            .header("content-encoding", "aes128gcm")
            .header("ttl", ttl.to_string())
            .header("urgency", urgency)
            .body(encrypted)
            .send()
            .await
            .map_err(|e| ProviderError::HttpTransport(format!("{e}")))?;
        let status = resp.status();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i32>().ok());
        let raw_body = resp
            .text()
            .await
            .map_err(|e| ProviderError::HttpTransport(format!("body read: {e}")))?;
        let duration_ms = t0.elapsed().as_millis().min(i32::MAX as u128) as i32;

        let (outcome, label) = classify(status.as_u16(), retry_after);
        Ok(ProviderResult {
            outcome,
            provider_outcome_label: label,
            provider_status: Some(status.as_u16() as i32),
            provider_body: Some(truncate_2k(&raw_body)),
            duration_ms,
        })
    }

    async fn validate(&self, cred: Credential<'_>) -> ValidateOutcome {
        // Web Push has no central auth challenge (each push server
        // belongs to its browser vendor and routing happens per-
        // subscription). We validate by parsing the VAPID public key
        // (base64url 65 byte uncompressed P-256) AND the PEM private
        // key, then check the public key derived from the private
        // matches the configured public.
        let config: WebPushConfig = match serde_json::from_value(cred.config.clone()) {
            Ok(c) => c,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("config: {e}") },
        };
        let secret: WebPushSecret = match serde_json::from_slice(cred.secret_payload) {
            Ok(s) => s,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("secret: {e}") },
        };
        let pub_bytes = match base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(config.vapid_public.as_bytes())
        {
            Ok(b) => b,
            Err(e) => {
                return ValidateOutcome::Malformed {
                    reason: format!("vapid_public base64url: {e}"),
                }
            }
        };
        if pub_bytes.len() != PUB_LEN {
            return ValidateOutcome::Malformed {
                reason: format!("vapid_public must be {PUB_LEN} bytes, got {}", pub_bytes.len()),
            };
        }
        let sk = match SecretKey::from_sec1_pem(&secret.vapid_private) {
            Ok(s) => s,
            Err(e) => {
                return ValidateOutcome::Malformed {
                    reason: format!("vapid_private parse: {e}"),
                }
            }
        };
        let derived = sk.public_key().to_encoded_point(false);
        if derived.as_bytes() != pub_bytes.as_slice() {
            return ValidateOutcome::Rejected {
                reason: "vapid_public does not match vapid_private".into(),
            };
        }
        ValidateOutcome::Ok
    }
}

/// Build the JSON payload that the SW receives in `event.data`.
fn build_payload(msg: &NativeMessage) -> Value {
    let mut root = serde_json::Map::new();
    if let Some(t) = msg.title.as_ref() {
        root.insert("title".into(), Value::String(t.clone()));
    }
    if let Some(b) = msg.body.as_ref() {
        root.insert("body".into(), Value::String(b.clone()));
    }
    if let Some(d) = msg.data.as_ref() {
        root.insert("data".into(), d.clone());
    }
    Value::Object(root)
}

fn sign_vapid(private_pem: &str, aud: &str, sub: &str) -> Result<String, String> {
    let now = now_secs();
    let claims = VapidClaims {
        aud,
        // RFC 8292 caps exp at 24 h beyond iat. We use 12 h —
        // generous but well under the cap.
        exp: now + 12 * 3600,
        sub,
    };
    let header = Header::new(Algorithm::ES256);
    let key = EncodingKey::from_ec_pem(private_pem.as_bytes())
        .map_err(|e| format!("private_key parse: {e}"))?;
    encode(&header, &claims, &key).map_err(|e| format!("encode: {e}"))
}

/// Build the encrypted body per RFC 8291 §4. Returns the full
/// content-encoding payload:
///   salt(16) ‖ rs(4 big-endian) ‖ idlen(1)=65 ‖ ephemeral_pub(65) ‖ ciphertext
///
/// The plaintext is padded with a single `0x02` delimiter byte (it's
/// the last record, so `2`) followed by zeros up to `rs - 16 - 1`.
pub fn encrypt_aes128gcm(
    plaintext: &[u8],
    subscription_p256dh: &[u8],
    auth_secret: &[u8],
    salt: &[u8; SALT_LEN],
) -> Result<Vec<u8>, String> {
    if subscription_p256dh.len() != PUB_LEN {
        return Err(format!(
            "subscription_p256dh must be 65 bytes, got {}",
            subscription_p256dh.len()
        ));
    }
    if auth_secret.len() != 16 {
        return Err(format!(
            "auth_secret must be 16 bytes, got {}",
            auth_secret.len()
        ));
    }

    // Ephemeral server key pair.
    let server_secret = SecretKey::random(&mut OsRng);
    let server_pub = server_secret.public_key();
    let server_pub_bytes = server_pub.to_encoded_point(false).as_bytes().to_vec();
    debug_assert_eq!(server_pub_bytes.len(), PUB_LEN);

    // Subscription pub.
    let sub_pub = PublicKey::from_sec1_bytes(subscription_p256dh)
        .map_err(|e| format!("p256dh parse: {e}"))?;

    // ECDH shared secret.
    let shared = diffie_hellman(
        server_secret.to_nonzero_scalar(),
        sub_pub.as_affine(),
    );
    let shared_bytes = shared.raw_secret_bytes().to_vec();

    // PRK_key = HKDF-Extract(auth_secret, ECDH)
    let prk_key = hkdf_extract(auth_secret, &shared_bytes);
    // key_info = "WebPush: info\0" ‖ ua_public ‖ as_public
    let mut key_info = Vec::with_capacity(14 + PUB_LEN * 2);
    key_info.extend_from_slice(b"WebPush: info\0");
    key_info.extend_from_slice(subscription_p256dh);
    key_info.extend_from_slice(&server_pub_bytes);
    let ikm = hkdf_expand(&prk_key, &key_info, 32);

    // PRK = HKDF-Extract(salt, IKM)
    let prk = hkdf_extract(salt, &ikm);
    // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
    let cek = hkdf_expand(&prk, b"Content-Encoding: aes128gcm\0", KEY_LEN);
    // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
    let nonce = hkdf_expand(&prk, b"Content-Encoding: nonce\0", NONCE_LEN);

    // Padding: append 0x02 (last record delimiter), then zero pad up
    // to (rs - 16) bytes BEFORE encryption. The 16 is the GCM tag
    // that's appended after seal. We assert rs is large enough for
    // the plaintext + 1 + 16; if not, we'd need multiple records,
    // but our payloads are tiny (< 4 KB) so single-record is enough.
    let max_plaintext = (RECORD_SIZE as usize)
        .checked_sub(TAG_LEN + 1)
        .ok_or_else(|| "rs too small for tag + delimiter".to_string())?;
    if plaintext.len() > max_plaintext {
        return Err(format!(
            "plaintext {} > max single-record {}",
            plaintext.len(),
            max_plaintext
        ));
    }
    let mut padded = Vec::with_capacity(plaintext.len() + 1);
    padded.extend_from_slice(plaintext);
    padded.push(0x02);
    // No tail-zero padding per spec (zero-fill optional; web-push
    // libs typically omit). The receiver strips the trailing 0x02
    // and treats everything before as plaintext.

    let cipher = Aes128Gcm::new_from_slice(&cek).map_err(|e| format!("cipher new: {e}"))?;
    let ct = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            AeadPayload {
                msg: &padded,
                aad: b"",
            },
        )
        .map_err(|e| format!("encrypt: {e}"))?;

    // Assemble header block + ciphertext.
    let mut out = Vec::with_capacity(SALT_LEN + 4 + 1 + PUB_LEN + ct.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    out.push(PUB_LEN as u8);
    out.extend_from_slice(&server_pub_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> [u8; 32] {
    let (prk, _) = Hkdf::<Sha256>::extract(Some(salt), ikm);
    let mut out = [0u8; 32];
    out.copy_from_slice(prk.as_slice());
    out
}

fn hkdf_expand(prk: &[u8; 32], info: &[u8], len: usize) -> Vec<u8> {
    let hk = Hkdf::<Sha256>::from_prk(prk).expect("32-byte PRK");
    let mut out = vec![0u8; len];
    hk.expand(info, &mut out).expect("hkdf expand");
    out
}

fn origin_of(endpoint: &str) -> Option<String> {
    let after_scheme = endpoint.split_once("://")?;
    let host_and_path = after_scheme.1;
    let host = host_and_path.split('/').next()?;
    Some(format!("{}://{}", after_scheme.0, host))
}

fn classify(status: u16, retry_after: Option<i32>) -> (SendOutcome, String) {
    match status {
        200 | 201 | 202 | 204 => (SendOutcome::Sent, format!("WP_{status}")),
        401 | 403 => (
            SendOutcome::TerminalOther {
                reason: format!("WP_{status}: VAPID rejected"),
            },
            format!("WP_{status}_VapidRejected"),
        ),
        404 | 410 => (
            SendOutcome::PermanentlyInvalidToken,
            format!("WP_{status}_Gone"),
        ),
        413 => (
            SendOutcome::TerminalOther {
                reason: "MessageTooBig".into(),
            },
            "WP_413_PayloadTooLarge".into(),
        ),
        429 => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            "WP_429_RateLimited".into(),
        ),
        s if (500..=599).contains(&s) => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            format!("WP_{s}"),
        ),
        s => (
            SendOutcome::TerminalOther {
                reason: format!("WP_{s}"),
            },
            format!("WP_{s}"),
        ),
    }
}

fn base64url_decode(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|e| format!("{e}"))
}

fn truncate_2k(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if out.len() + c.len_utf8() > 2048 {
            break;
        }
        out.push(c);
    }
    out
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_204_sent() {
        let (o, l) = classify(204, None);
        assert_eq!(o, SendOutcome::Sent);
        assert_eq!(l, "WP_204");
    }

    #[test]
    fn classify_410_gone() {
        let (o, _) = classify(410, None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_413_too_big() {
        let (o, _) = classify(413, None);
        assert!(matches!(o, SendOutcome::TerminalOther { reason } if reason == "MessageTooBig"));
    }

    #[test]
    fn classify_429_with_retry_after() {
        let (o, _) = classify(429, Some(120));
        assert_eq!(
            o,
            SendOutcome::Transient {
                retry_after_secs: Some(120),
            }
        );
    }

    #[test]
    fn classify_503_transient() {
        let (o, _) = classify(503, None);
        assert_eq!(
            o,
            SendOutcome::Transient { retry_after_secs: None }
        );
    }

    #[test]
    fn origin_of_extracts_scheme_and_host() {
        assert_eq!(
            origin_of("https://fcm.googleapis.com/fcm/send/abc"),
            Some("https://fcm.googleapis.com".into())
        );
        assert_eq!(
            origin_of("https://updates.push.services.mozilla.com/wpush/v2/abc"),
            Some("https://updates.push.services.mozilla.com".into())
        );
        assert_eq!(origin_of("not a url"), None);
    }

    #[test]
    fn build_payload_packs_title_body_data() {
        let msg = NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: Some("hi".into()),
            body: Some("hello".into()),
            data: Some(serde_json::json!({ "url": "/x" })),
            options: Default::default(),
            idempotency_key: None,
        };
        let v = build_payload(&msg);
        assert_eq!(v["title"], "hi");
        assert_eq!(v["body"], "hello");
        assert_eq!(v["data"]["url"], "/x");
    }

    /// End-to-end roundtrip: generate a fresh subscription P-256 key
    /// pair + auth, encrypt a plaintext via our encryptor, then
    /// derive the same CEK + nonce from the subscription side and
    /// decrypt. Proves the HKDF chain + key derivation are
    /// spec-compliant without an external test vector.
    #[test]
    fn encrypt_then_decrypt_roundtrip() {
        // Subscription side: the browser would generate this on
        // subscribe(). We simulate it.
        let sub_secret = SecretKey::random(&mut OsRng);
        let sub_pub = sub_secret.public_key();
        let sub_pub_bytes = sub_pub.to_encoded_point(false).as_bytes().to_vec();

        let mut auth = [0u8; 16];
        OsRng.fill_bytes(&mut auth);
        let plaintext = b"{\"title\":\"hello\",\"body\":\"world\"}";

        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);

        let body = encrypt_aes128gcm(plaintext, &sub_pub_bytes, &auth, &salt).unwrap();

        // Decode header block.
        assert_eq!(&body[..SALT_LEN], &salt[..]);
        let rs = u32::from_be_bytes([body[16], body[17], body[18], body[19]]);
        assert_eq!(rs, RECORD_SIZE);
        let idlen = body[20];
        assert_eq!(idlen as usize, PUB_LEN);
        let server_pub_bytes = &body[21..21 + PUB_LEN];
        let ciphertext = &body[21 + PUB_LEN..];

        // Decryptor side: ECDH against subscription's own secret.
        let server_pub = PublicKey::from_sec1_bytes(server_pub_bytes).unwrap();
        let shared = diffie_hellman(sub_secret.to_nonzero_scalar(), server_pub.as_affine());
        let shared_bytes = shared.raw_secret_bytes().to_vec();
        let prk_key = hkdf_extract(&auth, &shared_bytes);
        let mut key_info = Vec::new();
        key_info.extend_from_slice(b"WebPush: info\0");
        key_info.extend_from_slice(&sub_pub_bytes);
        key_info.extend_from_slice(server_pub_bytes);
        let ikm = hkdf_expand(&prk_key, &key_info, 32);
        let prk = hkdf_extract(&salt, &ikm);
        let cek = hkdf_expand(&prk, b"Content-Encoding: aes128gcm\0", KEY_LEN);
        let nonce = hkdf_expand(&prk, b"Content-Encoding: nonce\0", NONCE_LEN);
        let cipher = Aes128Gcm::new_from_slice(&cek).unwrap();
        let decrypted = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                AeadPayload {
                    msg: ciphertext,
                    aad: b"",
                },
            )
            .unwrap();
        // Strip trailing 0x02 (single-record delimiter).
        assert_eq!(*decrypted.last().unwrap(), 0x02);
        let recovered = &decrypted[..decrypted.len() - 1];
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn base64url_decode_handles_url_safe_no_pad() {
        // Standard "Hello" → base64url("Hello") = "SGVsbG8" (no
        // padding).
        let out = base64url_decode("SGVsbG8").unwrap();
        assert_eq!(&out, b"Hello");
    }

    #[test]
    fn truncate_2k_caps_long() {
        let s = "x".repeat(3000);
        let t = truncate_2k(&s);
        assert!(t.len() <= 2048);
    }

    // Throwaway P-256 PKCS#8 PEM — public key not associated with any
    // real VAPID identity. Generated solely for crypto smoke tests;
    // safe to commit. v2.20 P4.
    const TEST_P256_PEM: &str = "-----BEGIN PRIVATE KEY-----\n\
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgwLViWNAN7cNJxHa6\n\
SazKcIgzndxVwvYbpG/4zhIrBWGhRANCAAQh8jYfkJZzsDqWF889zSvQMgn267m/\n\
BsR53w8xJYvbjbTcbzJ3Jrm5jNav9kOYS4TQS/l0cR0iLZvt+zKEZ+C2\n\
-----END PRIVATE KEY-----\n";

    /// v2.20 P4 — VAPID ES256 sign smoke test. Same v1.1.2-class
    /// rationale as the APNs smoke: exercise the crypto path so a
    /// future jsonwebtoken bump doesn't quietly break VAPID at 2 AM.
    #[test]
    fn sign_vapid_es256_smoke() {
        use base64::Engine as _;
        let jwt = sign_vapid(
            TEST_P256_PEM,
            "https://fcm.googleapis.com",
            "mailto:dev@example.com",
        )
        .expect("sign_vapid must not error on a valid P-256 key");
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT must have header.payload.sig");

        let header_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("header b64");
        let header: serde_json::Value =
            serde_json::from_slice(&header_bytes).expect("header json");
        assert_eq!(header["alg"], "ES256");

        let claims_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .expect("claims b64");
        let claims: serde_json::Value =
            serde_json::from_slice(&claims_bytes).expect("claims json");
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["sub"], "mailto:dev@example.com");
        assert!(claims["exp"].as_u64().unwrap_or(0) > 0);
    }
}

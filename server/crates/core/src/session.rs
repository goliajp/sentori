use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Stateless admin session token = HMAC-SHA256(secret, "admin"), hex.
/// Rotating the secret invalidates all sessions.
pub fn sign(secret: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("hmac accepts any key length");
    mac.update(b"admin");
    hex::encode(mac.finalize().into_bytes())
}

pub fn verify(secret: &str, token: &str) -> bool {
    let expected = sign(secret);
    constant_time_eq(token.as_bytes(), expected.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

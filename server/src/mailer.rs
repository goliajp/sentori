// v1.0 — outbound transactional email (password reset, verification).
//
// Distinct from `notifier::start` which runs as a background task
// dispatching alert events. This module is for synchronous one-shot
// sends from request handlers (forgot-password) and the boot-time
// seed (`ensure_superadmin`).
//
// Falls back gracefully:
//   * `config_from_env()` returns None when SENTORI_SMTP_HOST is unset
//     → caller logs the link at INFO and the user grabs it from the
//     server log (the documented "no SMTP configured" path).
//   * When config is present but delivery fails (server unreachable,
//     auth rejected), we log a warn and return Err — callers should
//     still complete the request (don't fail a password reset just
//     because email's down; the link is in the log anyway).

use anyhow::{Context, Result};
use lettre::{
    AsyncTransport, Message, Tokio1Executor,
    transport::smtp::{AsyncSmtpTransport, authentication::Credentials},
};

use crate::notifier::{NotifierConfig, SmtpTls};

/// Resolve the SMTP config from the same env vars `notifier` uses.
/// Returns None when the SMTP host isn't configured.
pub fn config_from_env() -> Option<NotifierConfig> {
    let host = std::env::var("SENTORI_SMTP_HOST")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    Some(NotifierConfig {
        smtp_host: host,
        smtp_port: std::env::var("SENTORI_SMTP_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(587),
        smtp_user: std::env::var("SENTORI_SMTP_USER")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        smtp_pass: std::env::var("SENTORI_SMTP_PASS")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        from: std::env::var("SENTORI_SMTP_FROM")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "sentori@golia.jp".to_string()),
        tls: SmtpTls::from_env(&std::env::var("SENTORI_SMTP_TLS").unwrap_or_default()),
    })
}

/// Send a plain-text email through the configured SMTP relay.
/// One-shot — opens a new connection, sends, closes.
pub async fn send_plain(
    cfg: &NotifierConfig,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<()> {
    let mut builder = match cfg.tls {
        SmtpTls::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.smtp_host)
            .context("starttls relay builder")?,
        SmtpTls::Plain => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&cfg.smtp_host),
    }
    .port(cfg.smtp_port);
    if let (Some(u), Some(p)) = (&cfg.smtp_user, &cfg.smtp_pass) {
        builder = builder.credentials(Credentials::new(u.clone(), p.clone()));
    }
    let mailer = builder.build();

    let msg = Message::builder()
        .from(cfg.from.parse().context("parse From")?)
        .to(to.parse().context("parse To")?)
        .subject(subject)
        .body(body.to_string())
        .context("build message")?;

    mailer.send(msg).await.context("smtp send")?;
    Ok(())
}

/// Convenience — fire a password-reset email. Returns Ok(true) when
/// sent, Ok(false) when SMTP isn't configured (caller falls back to
/// the log-the-link path), Err on actual failures.
pub async fn send_password_reset(to: &str, link: &str) -> Result<bool> {
    let Some(cfg) = config_from_env() else {
        return Ok(false);
    };
    let body = format!(
        "Hi,\n\n\
         Use the link below to set a new password on Sentori.\n\
         The link is valid for 48 hours and single-use.\n\n\
         {link}\n\n\
         If you didn't request this, ignore the email — your password\n\
         won't change.\n\n\
         — Sentori\n",
    );
    send_plain(&cfg, to, "Reset your Sentori password", &body).await?;
    Ok(true)
}

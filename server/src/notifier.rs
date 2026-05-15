use anyhow::{Context, Result};
use lettre::message::{Mailbox, Message};
use lettre::transport::smtp::AsyncSmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncTransport, Tokio1Executor};
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

/// How notifier should establish the SMTP connection. Production
/// defaults to `Starttls` (Let's Encrypt or whatever the relay uses);
/// dev / mailcatcher tests need `Plain` because mailcatcher doesn't
/// negotiate STARTTLS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmtpTls {
    Starttls,
    Plain,
}

impl SmtpTls {
    pub fn from_env(s: &str) -> Self {
        match s.to_ascii_lowercase().as_str() {
            "plain" | "none" | "off" => Self::Plain,
            _ => Self::Starttls,
        }
    }
}

#[derive(Clone, Debug)]
pub struct NotifierConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub from: String,
    pub tls: SmtpTls,
}

#[derive(Debug, Clone)]
pub enum NotifyEvent {
    NewIssue {
        project_id: Uuid,
        issue_id: Uuid,
        error_type: String,
        message: String,
    },
    /// Phase 23 sub-D: previously-resolved issue had a fresh event,
    /// flipping `status` back to `regressed`. Goes to recipients with
    /// `on_regression = TRUE`.
    Regression {
        project_id: Uuid,
        issue_id: Uuid,
        error_type: String,
        message: String,
        release: String,
    },
    EmailVerification {
        email: String,
        link: String,
    },
    OrgInvite {
        email: String,
        org_name: String,
        inviter_email: String,
        link: String,
    },
    QuotaWarning {
        org_id: Uuid,
        threshold: u8,
        current: u64,
        limit: i32,
        reset_at: time::OffsetDateTime,
    },
    OwnershipTransferRequested {
        to_email: String,
        from_email: String,
        org_name: String,
        link: String,
    },
    OwnershipTransferCompleted {
        old_owner_email: String,
        new_owner_email: String,
        org_name: String,
    },
    /// Phase 27 sub-B: rule evaluator fired an alert. The notifier
    /// fans out to every channel in `channels` (email today, webhook
    /// in sub-D). `summary` is a one-line subject the channels can
    /// reuse; `body` is multi-line context for email rendering.
    AlertFired {
        rule_id: Uuid,
        rule_name: String,
        org_id: Uuid,
        channels: serde_json::Value,
        summary: String,
        body: String,
    },
    /// Phase 27 sub-E: opt-in digest sent by the hourly evaluator.
    /// One per (user, org, frequency) — same summary text goes to
    /// each subscribed user but as their own email so unsubscribing
    /// doesn't ripple.
    DigestEmail {
        to: String,
        org_name: String,
        org_slug: String,
        frequency: String,
        summary_lines: Vec<String>,
        window_hours: u32,
    },
    /// v0.8.4 — cert-monitor saw a never-before-observed certificate
    /// issued for a watched domain. Recipients are the project's
    /// notification list (same set as NewIssue). One email per
    /// observation; rate-limiting / digesting is deferred until a
    /// customer hits noisy LE renewal volume.
    CertObserved {
        project_id: Uuid,
        domain: String,
        cert_id: i64,
        common_name: Option<String>,
        issuer_name: String,
        not_before: time::OffsetDateTime,
        not_after: time::OffsetDateTime,
    },
}

/// Spawn the notifier loop. Returns a sender producers can use to enqueue
/// notifications. If `config` is None the loop still runs but no-ops; we
/// keep the channel so call sites don't need to special-case the "no
/// SMTP" path.
pub fn start(config: Option<NotifierConfig>, pool: PgPool) -> mpsc::Sender<NotifyEvent> {
    let (tx, mut rx) = mpsc::channel::<NotifyEvent>(256);

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let Err(e) = handle(config.as_ref(), &pool, &event).await {
                tracing::error!(error = %e, ?event, "notifier failed");
            }
        }
    });

    tx
}

async fn handle(
    cfg: Option<&NotifierConfig>,
    pool: &PgPool,
    event: &NotifyEvent,
) -> Result<()> {
    let cfg = match cfg {
        Some(c) => c,
        None => return Ok(()),
    };

    match event {
        NotifyEvent::NewIssue {
            project_id,
            issue_id,
            error_type,
            message,
        } => {
            let recipients: Vec<String> = sqlx::query_scalar(
                "SELECT email FROM notification_recipients \
                 WHERE project_id = $1 AND on_new_issue = TRUE",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await
            .context("fetch recipients")?;

            if recipients.is_empty() {
                return Ok(());
            }

            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;

            for email in recipients {
                let to: Mailbox = match email.parse() {
                    Ok(addr) => addr,
                    Err(e) => {
                        tracing::warn!(error = %e, %email, "skip invalid recipient");
                        continue;
                    }
                };
                let msg = Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(format!("[Sentori] New issue: {error_type}"))
                    .body(format!(
                        "New issue captured by Sentori.\n\n\
                         Type:    {error_type}\n\
                         Message: {message}\n\
                         Issue:   {issue_id}\n\n\
                         — Sentori"
                    ))
                    .context("build message")?;

                if let Err(e) = transport.send(msg).await {
                    tracing::warn!(error = %e, %email, %issue_id, "send email failed");
                } else {
                    tracing::info!(%email, %issue_id, "new-issue email sent");
                }
            }
            Ok(())
        }
        NotifyEvent::Regression {
            project_id,
            issue_id,
            error_type,
            message,
            release,
        } => {
            let recipients: Vec<String> = sqlx::query_scalar(
                "SELECT email FROM notification_recipients \
                 WHERE project_id = $1 AND on_regression = TRUE",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await
            .context("fetch regression recipients")?;

            if recipients.is_empty() {
                return Ok(());
            }

            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;

            for email in recipients {
                let to: Mailbox = match email.parse() {
                    Ok(addr) => addr,
                    Err(e) => {
                        tracing::warn!(error = %e, %email, "skip invalid recipient");
                        continue;
                    }
                };
                let msg = Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(format!("[Sentori] Regression: {error_type}"))
                    .body(format!(
                        "An issue you previously marked resolved has come back.\n\n\
                         Type:    {error_type}\n\
                         Message: {message}\n\
                         Release: {release}\n\
                         Issue:   {issue_id}\n\n\
                         — Sentori"
                    ))
                    .context("build regression message")?;

                if let Err(e) = transport.send(msg).await {
                    tracing::warn!(error = %e, %email, %issue_id, "send regression email failed");
                } else {
                    tracing::info!(%email, %issue_id, "regression email sent");
                }
            }
            Ok(())
        }
        NotifyEvent::EmailVerification { email, link } => {
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let to: Mailbox = email.parse().context("parse to address")?;
            let msg = Message::builder()
                .from(from)
                .to(to)
                .subject("[Sentori] Verify your email")
                .body(format!(
                    "Welcome to Sentori.\n\n\
                     Click to verify your email address:\n{link}\n\n\
                     This link expires in 24 hours.\n\n\
                     — Sentori"
                ))
                .context("build verify message")?;

            if let Err(e) = transport.send(msg).await {
                tracing::warn!(error = %e, %email, "send verification email failed");
            } else {
                tracing::info!(%email, "verification email sent");
            }
            Ok(())
        }
        NotifyEvent::OrgInvite {
            email,
            org_name,
            inviter_email,
            link,
        } => {
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let to: Mailbox = email.parse().context("parse invite to address")?;
            let msg = Message::builder()
                .from(from)
                .to(to)
                .subject(format!("[Sentori] You're invited to {org_name}"))
                .body(format!(
                    "{inviter_email} invited you to join the \"{org_name}\" \
                     organization on Sentori.\n\n\
                     Accept the invite:\n{link}\n\n\
                     This link expires in 7 days.\n\n\
                     — Sentori"
                ))
                .context("build invite message")?;

            if let Err(e) = transport.send(msg).await {
                tracing::warn!(error = %e, %email, %org_name, "send invite email failed");
            } else {
                tracing::info!(%email, %org_name, "invite email sent");
            }
            Ok(())
        }
        NotifyEvent::QuotaWarning {
            org_id,
            threshold,
            current,
            limit,
            reset_at,
        } => {
            let recipients: Vec<(String, String)> = sqlx::query_as(
                "SELECT u.email, o.name FROM users u \
                 JOIN memberships m ON m.user_id = u.id \
                 JOIN orgs o ON o.id = m.org_id \
                 WHERE m.org_id = $1 AND m.role IN ('owner', 'admin')",
            )
            .bind(org_id)
            .fetch_all(pool)
            .await
            .context("fetch quota recipients")?;

            if recipients.is_empty() {
                return Ok(());
            }

            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let org_name = recipients
                .first()
                .map(|(_, n)| n.clone())
                .unwrap_or_default();

            let (subject, summary) = if *threshold >= 100 {
                (
                    format!("[Sentori] Monthly event quota reached — {org_name}"),
                    format!(
                        "Your Sentori org \"{org_name}\" has reached its monthly event \
                         quota ({current} / {limit}). New events are being dropped \
                         until the quota resets at {reset_at}."
                    ),
                )
            } else {
                (
                    format!("[Sentori] {threshold}% of monthly event quota used — {org_name}"),
                    format!(
                        "Your Sentori org \"{org_name}\" is at {threshold}% of its \
                         monthly event quota ({current} / {limit}). The counter \
                         resets at {reset_at}."
                    ),
                )
            };

            for (email, _) in recipients {
                let to: Mailbox = match email.parse() {
                    Ok(addr) => addr,
                    Err(e) => {
                        tracing::warn!(error = %e, %email, "skip invalid recipient");
                        continue;
                    }
                };
                let msg = Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(subject.clone())
                    .body(format!("{summary}\n\n— Sentori"))
                    .context("build quota message")?;
                if let Err(e) = transport.send(msg).await {
                    tracing::warn!(error = %e, %email, %org_id, threshold, "send quota email failed");
                } else {
                    tracing::info!(%email, %org_id, threshold, "quota email sent");
                }
            }
            Ok(())
        }
        NotifyEvent::OwnershipTransferRequested {
            to_email,
            from_email,
            org_name,
            link,
        } => {
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let to: Mailbox = to_email.parse().context("parse transfer to address")?;
            let msg = Message::builder()
                .from(from)
                .to(to)
                .subject(format!(
                    "[Sentori] Ownership of \"{org_name}\" is being transferred to you"
                ))
                .body(format!(
                    "{from_email} wants to transfer ownership of the Sentori organization \
                     \"{org_name}\" to you.\n\n\
                     Confirm the transfer:\n{link}\n\n\
                     This link expires in 7 days. If you didn't expect this, ignore this \
                     email — no change happens until you click the link.\n\n\
                     — Sentori"
                ))
                .context("build transfer message")?;

            if let Err(e) = transport.send(msg).await {
                tracing::warn!(error = %e, %to_email, %org_name, "send transfer email failed");
            } else {
                tracing::info!(%to_email, %org_name, "transfer email sent");
            }
            Ok(())
        }
        NotifyEvent::OwnershipTransferCompleted {
            old_owner_email,
            new_owner_email,
            org_name,
        } => {
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let to: Mailbox = old_owner_email
                .parse()
                .context("parse old owner address")?;
            let msg = Message::builder()
                .from(from)
                .to(to)
                .subject(format!(
                    "[Sentori] Ownership of \"{org_name}\" transferred to {new_owner_email}"
                ))
                .body(format!(
                    "You've successfully transferred ownership of the Sentori organization \
                     \"{org_name}\" to {new_owner_email}.\n\n\
                     Your role has been moved to admin. You can still manage members and \
                     projects, but only {new_owner_email} can now delete the org or transfer \
                     it again.\n\n\
                     If this wasn't you, contact support@sentori.golia.jp immediately.\n\n\
                     — Sentori"
                ))
                .context("build transfer-completed message")?;

            if let Err(e) = transport.send(msg).await {
                tracing::warn!(error = %e, %old_owner_email, %org_name, "send transfer-completed email failed");
            } else {
                tracing::info!(%old_owner_email, %org_name, "transfer-completed email sent");
            }
            Ok(())
        }
        NotifyEvent::AlertFired {
            rule_id,
            rule_name,
            channels,
            summary,
            body,
            org_id,
        } => {
            // Iterate channels[]; today only `email` is implemented.
            // Webhook channel handler lands in Phase 27 sub-D.
            let Some(arr) = channels.as_array() else {
                return Ok(());
            };
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;

            for ch in arr {
                let kind = ch.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match kind {
                    "email" => {
                        let Some(to_arr) = ch.get("to").and_then(|v| v.as_array()) else {
                            continue;
                        };
                        for to_v in to_arr {
                            let Some(addr) = to_v.as_str() else {
                                continue;
                            };
                            let to: Mailbox = match addr.parse() {
                                Ok(m) => m,
                                Err(e) => {
                                    tracing::warn!(error = %e, %addr, "skip invalid alert recipient");
                                    continue;
                                }
                            };
                            let msg = Message::builder()
                                .from(from.clone())
                                .to(to)
                                .subject(format!("[Sentori] Alert: {rule_name} — {summary}"))
                                .body(format!(
                                    "{body}\n\n\
                                     Rule:    {rule_name}\n\
                                     Rule id: {rule_id}\n\n\
                                     — Sentori"
                                ))
                                .context("build alert message")?;
                            if let Err(e) = transport.send(msg).await {
                                tracing::warn!(error = %e, %addr, %rule_id, "send alert email failed");
                            } else {
                                tracing::info!(%addr, %rule_id, "alert email sent");
                            }
                        }
                    }
                    "webhook" => {
                        // Phase 29 sub-B: enqueue into webhook_deliveries.
                        // The dispatcher (webhook_dispatch::spawn_cron) picks
                        // up pending rows on its next sweep, signs + sends,
                        // and retries on [60s, 5m, 30m, 2h, 12h, 24h] up to
                        // six attempts before marking failed. We don't even
                        // try to send synchronously anymore — losing a
                        // notifier shutdown to an in-flight HTTP roundtrip
                        // isn't worth it.
                        let url = ch
                            .get("url")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let secret = ch
                            .get("secret")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string();
                        if url.is_empty() || secret.is_empty() {
                            tracing::warn!(%rule_id, "webhook channel missing url/secret");
                            continue;
                        }
                        let payload = serde_json::json!({
                            "id":         uuid::Uuid::now_v7(),
                            "kind":       "alert.fired",
                            "ruleId":     rule_id,
                            "ruleName":   rule_name,
                            "orgId":      org_id,
                            "summary":    summary,
                            "body":       body,
                            "firedAt":    time::OffsetDateTime::now_utc()
                                .format(&time::format_description::well_known::Rfc3339)
                                .unwrap_or_default(),
                        });
                        match crate::webhook::enqueue(pool, *rule_id, payload, url, secret).await {
                            Ok(delivery_id) => {
                                tracing::info!(%rule_id, %delivery_id, "webhook enqueued");
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, %rule_id, "webhook enqueue failed");
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(())
        }
        NotifyEvent::DigestEmail {
            to,
            org_name,
            org_slug,
            frequency,
            summary_lines,
            window_hours,
        } => {
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let to_addr: Mailbox = match to.parse() {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!(error = %e, %to, "skip invalid digest recipient");
                    return Ok(());
                }
            };
            let lines = summary_lines.join("\n");
            let frequency_label = if frequency == "weekly" { "Weekly" } else { "Daily" };
            let msg = Message::builder()
                .from(from)
                .to(to_addr)
                .subject(format!("[Sentori] {frequency_label} digest — {org_name}"))
                .body(format!(
                    "{frequency_label} summary for {org_name} (slug: {org_slug}).\n\
                     Window covers the last {window_hours}h.\n\n\
                     {lines}\n\n\
                     Manage subscriptions in your Sentori settings.\n\n\
                     — Sentori"
                ))
                .context("build digest message")?;
            if let Err(e) = transport.send(msg).await {
                tracing::warn!(error = %e, %to, "send digest email failed");
            } else {
                tracing::info!(%to, %frequency, "digest email sent");
            }
            Ok(())
        }
        NotifyEvent::CertObserved {
            project_id,
            domain,
            cert_id,
            common_name,
            issuer_name,
            not_before,
            not_after,
        } => {
            // v0.8.4 — recipients are the project's NewIssue list (a
            // cert popping up on your domain is at least as urgent as
            // a new issue). We can split this into its own column on
            // notification_recipients once a customer asks for
            // per-feature opt-in granularity.
            let recipients: Vec<String> = sqlx::query_scalar(
                "SELECT email FROM notification_recipients \
                 WHERE project_id = $1 AND on_new_issue = TRUE",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await
            .context("fetch cert-monitor recipients")?;
            if recipients.is_empty() {
                return Ok(());
            }
            let transport = build_transport(cfg)?;
            let from: Mailbox = cfg.from.parse().context("parse from address")?;
            let cn_line = common_name
                .as_deref()
                .map(|c| format!("Common name: {c}\n"))
                .unwrap_or_default();
            let body = format!(
                "A new certificate has been observed on the public CT logs for a domain you're \
                 monitoring with Sentori.\n\n\
                 Domain watched: {domain}\n\
                 {cn_line}\
                 Issuer: {issuer_name}\n\
                 Valid: {not_before} → {not_after}\n\
                 crt.sh id: {cert_id} (https://crt.sh/?id={cert_id})\n\n\
                 If you didn't expect this certificate, investigate immediately: \
                 someone may have obtained a certificate for your domain.\n\n\
                 — Sentori cert monitor"
            );
            for email in recipients {
                let to: Mailbox = match email.parse() {
                    Ok(m) => m,
                    Err(e) => {
                        tracing::warn!(error = %e, %email, "skip invalid cert-monitor recipient");
                        continue;
                    }
                };
                let msg = Message::builder()
                    .from(from.clone())
                    .to(to)
                    .subject(format!("[Sentori] New cert observed for {domain}"))
                    .body(body.clone())
                    .context("build cert-monitor message")?;
                if let Err(e) = transport.send(msg).await {
                    tracing::warn!(error = %e, %email, "send cert-monitor email failed");
                }
            }
            Ok(())
        }
    }
}

fn build_transport(cfg: &NotifierConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
    let mut builder = match cfg.tls {
        SmtpTls::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.smtp_host)
            .context("starttls relay")?,
        SmtpTls::Plain => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&cfg.smtp_host),
    }
    .port(cfg.smtp_port);

    if let (Some(u), Some(p)) = (&cfg.smtp_user, &cfg.smtp_pass) {
        builder = builder.credentials(Credentials::new(u.clone(), p.clone()));
    }

    Ok(builder.build())
}

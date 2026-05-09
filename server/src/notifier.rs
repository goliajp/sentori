use anyhow::{Context, Result};
use lettre::message::{Mailbox, Message};
use lettre::transport::smtp::AsyncSmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncTransport, Tokio1Executor};
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct NotifierConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: Option<String>,
    pub smtp_pass: Option<String>,
    pub from: String,
}

#[derive(Debug, Clone)]
pub enum NotifyEvent {
    NewIssue {
        project_id: Uuid,
        issue_id: Uuid,
        error_type: String,
        message: String,
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
    }
}

fn build_transport(cfg: &NotifierConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.smtp_host)
        .context("starttls relay")?
        .port(cfg.smtp_port);

    if let (Some(u), Some(p)) = (&cfg.smtp_user, &cfg.smtp_pass) {
        builder = builder.credentials(Credentials::new(u.clone(), p.clone()));
    }

    Ok(builder.build())
}

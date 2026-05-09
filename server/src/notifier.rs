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

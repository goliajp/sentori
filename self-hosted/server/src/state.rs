//! Shared axum app state — handles to every K-tier service
//! the handlers compose.
//!
//! Self-hosted is single-workspace; AppState carries the
//! constant `DEFAULT_WORKSPACE_ID` and every workspace-bound
//! service is constructed scoped to it.

use std::sync::Arc;

use sqlx::PgPool;

use sentori_alert_rule::AlertRuleService;
use sentori_attachment_store::MemoryBlobStore;

use crate::blob_store::AttachmentStore;

/// One row of the broadcast bus — minimal so the channel stays
/// cheap to clone per fanout.
#[derive(Clone, Debug)]
pub struct RecentEventTick {
    pub project_id: uuid::Uuid,
    pub issue_id: uuid::Uuid,
    pub event_id: uuid::Uuid,
    pub kind: String,
    pub release: String,
    pub environment: String,
    pub platform: String,
    pub timestamp: time::OffsetDateTime,
}
use sentori_audit_event::AuditService;
use sentori_billing::BillingService;
use sentori_event_pipeline::{IngestOptions, IngestService};
use sentori_integration_traits::IntegrationService;
use sentori_issue_store::IssueStore;
use sentori_notifier::NotifierService;
use sentori_push_provider::DeviceTokenStore;
use sentori_replay_store::ReplayStore;
use sentori_runtime_metrics::MetricsStore;
use sentori_saved_view::SavedViewService;
use sentori_span_store::SpanStore;
use sentori_tenant_scoping::TenantGuard;
use sentori_workspace_identity::{Identity, WorkspaceId};

/// One-shot app state. All K services share the same
/// `PgPool` (sqlx pool itself is `Arc`-internally). Cheap
/// to clone.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub workspace_id: WorkspaceId,
    pub identity: Identity,
    pub ingest: IngestService,
    pub issues: IssueStore,
    pub spans: SpanStore,
    pub replays: ReplayStore<MemoryBlobStore>,
    pub metrics: MetricsStore,
    pub notifier: NotifierService,
    pub integrations: IntegrationService,
    pub audit: AuditService,
    pub alerts: AlertRuleService,
    pub saved_views: SavedViewService,
    pub tenant: TenantGuard,
    pub billing: BillingService,
    pub push_tokens: DeviceTokenStore,
    /// Shared blob store for event_attachments (replay /
    /// screenshot / sourcemap / dsym / proguard). Phase D uses
    /// MemoryBlobStore; Phase E swaps to LocalFsBlobStore.
    pub attachments: AttachmentStore,
    /// Broadcast channel for live event tail (events_recent SSE).
    /// Capacity 512 — slow subscribers drop oldest, not the
    /// fast ones.
    pub events_bus: tokio::sync::broadcast::Sender<RecentEventTick>,
}

impl AppState {
    /// Build every K service against the shared pool + the
    /// given workspace scope.
    ///
    /// # Panics
    ///
    /// `IngestService::new` returns `Result` for the
    /// fingerprint hasher init; v0.1 panics on the
    /// vanishingly unlikely failure since it's a process-
    /// boot wiring step.
    #[must_use]
    pub fn new(pool: PgPool, workspace_id: WorkspaceId, attachments: AttachmentStore) -> Self {
        let (events_bus, _) = tokio::sync::broadcast::channel(512);
        let identity = Identity::new(pool.clone(), workspace_id);
        let ingest = IngestService::new(pool.clone(), IngestOptions::default())
            .expect("ingest service must build");
        let issues = IssueStore::new(pool.clone());
        let spans = SpanStore::new(pool.clone());
        let replays = ReplayStore::new(
            pool.clone(),
            MemoryBlobStore::new(),
            sentori_replay_store::Scrubber::owasp_default(),
        );
        let metrics = MetricsStore::new(pool.clone());
        let notifier = NotifierService::new(pool.clone());
        let integrations = IntegrationService::new(pool.clone());
        let audit = AuditService::new(pool.clone());
        let alerts = AlertRuleService::new(pool.clone());
        let saved_views = SavedViewService::new(pool.clone());
        let tenant = TenantGuard::new(pool.clone(), workspace_id);
        let billing = BillingService::new(pool.clone(), workspace_id);
        let push_tokens = DeviceTokenStore::new(pool.clone());
        Self {
            pool,
            workspace_id,
            identity,
            ingest,
            issues,
            spans,
            replays,
            metrics,
            notifier,
            integrations,
            audit,
            alerts,
            saved_views,
            tenant,
            billing,
            push_tokens,
            attachments,
            events_bus,
        }
    }
}

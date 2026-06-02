// Phase 42 sub-C.08 — verify retention sweep drops both event_attachments
// rows and the matching on-disk blobs once they're past the events cutoff.
// Skips cleanly when DATABASE_URL isn't set so unit-only CI can pass.

use std::sync::Arc;

use sentori_server::attachments::{LocalFsAttachmentStore, SharedAttachmentStore};
use sentori_server::{db, retention, seed};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn setup() -> Option<(PgPool, tempfile::TempDir, SharedAttachmentStore)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    seed::ensure_dev_project(&pool).await.ok()?;
    let dir = tempfile::tempdir().ok()?;
    let store: SharedAttachmentStore = Arc::new(LocalFsAttachmentStore::new(dir.path()));
    Some((pool, dir, store))
}

async fn insert_attachment_row(
    pool: &PgPool,
    ref_id: Uuid,
    event_id: Uuid,
    project_id: Uuid,
    received_at: OffsetDateTime,
) {
    sqlx::query(
        r#"
        INSERT INTO event_attachments
            (ref, event_id, project_id, kind, media_type, size_bytes,
             captured_at, source, received_at)
        VALUES ($1, $2, $3, 'screenshot', 'image/webp', 100,
                $4, 'js', $4)
        "#,
    )
    .bind(ref_id)
    .bind(event_id)
    .bind(project_id)
    .bind(received_at)
    .execute(pool)
    .await
    .expect("insert attachment row");
}

async fn row_exists(pool: &PgPool, ref_id: Uuid) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT count(*) FROM event_attachments WHERE ref = $1")
        .bind(ref_id)
        .fetch_one(pool)
        .await
        .expect("count")
        > 0
}

#[tokio::test]
async fn prune_attachments_drops_old_rows_and_blobs() {
    let Some((pool, _tmp, store)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let project_id = seed::DEV_PROJECT_ID;
    let now = OffsetDateTime::now_utc();

    // One stale (40d old, must be deleted) and one fresh (10d old,
    // must stay) attachment, with on-disk blobs to match.
    let stale_event = Uuid::now_v7();
    let stale_ref = Uuid::now_v7();
    let fresh_event = Uuid::now_v7();
    let fresh_ref = Uuid::now_v7();

    store.put(project_id, stale_event, stale_ref, b"stale").await.unwrap();
    store.put(project_id, fresh_event, fresh_ref, b"fresh").await.unwrap();
    insert_attachment_row(&pool, stale_ref, stale_event, project_id, now - Duration::days(40)).await;
    insert_attachment_row(&pool, fresh_ref, fresh_event, project_id, now - Duration::days(10)).await;

    // 30d cutoff: stale (40d) goes, fresh (10d) stays.
    let cutoff = now - Duration::days(30);
    let deleted = retention::prune_attachments(&pool, &store, cutoff).await.expect("prune");
    assert!(deleted >= 1, "stale row should have been deleted");

    // DB-side assertions
    assert!(!row_exists(&pool, stale_ref).await, "stale row should be gone");
    assert!(row_exists(&pool, fresh_ref).await, "fresh row should remain");
    // Disk-side assertions
    assert!(matches!(
        store.get(project_id, stale_event, stale_ref).await,
        Err(sentori_server::attachments::AttachmentError::NotFound)
    ));
    assert!(store.get(project_id, fresh_event, fresh_ref).await.is_ok());

    // cleanup
    sqlx::query("DELETE FROM event_attachments WHERE ref = $1")
        .bind(fresh_ref)
        .execute(&pool)
        .await
        .ok();
}

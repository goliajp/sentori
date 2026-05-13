// Phase 42 sub-C.02/03 — pluggable storage for event attachments.
//
// `AttachmentStore` is the trait the ingest + admin paths see. There
// are two intentional implementations:
//   - `LocalFsAttachmentStore` — default; writes blobs under
//     `$SENTORI_ATTACHMENT_DIR/<project>/<event>/<ref>.bin`. Works
//     for single-VM self-hosted deployments and is what the SaaS
//     edge will run while we're still small.
//   - `NoopAttachmentStore` — for unit tests / when no directory is
//     configured. Refuses all writes (500 from the upload endpoint
//     surfaced as `attachmentsDisabled`).
//
// The trait is intentionally narrow: no streaming, no presigned URLs,
// no checksums. Bigger blobs (>500KB) hit the multipart limit in the
// HTTP layer first. We'll extend the trait the day we add S3.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AttachmentError {
    #[error("not found")]
    NotFound,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("disabled (set SENTORI_ATTACHMENT_DIR)")]
    Disabled,
}

#[async_trait]
pub trait AttachmentStore: Send + Sync {
    /// Write a blob under (project, event, ref). Overwrites a
    /// previous blob with the same ref — refs are server-generated
    /// UUIDs so collisions in practice mean a retry on the same
    /// upload, which is benign.
    async fn put(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
        data: &[u8],
    ) -> Result<(), AttachmentError>;

    /// Fetch a blob by ref. Returns `NotFound` if either the file
    /// doesn't exist or the caller-supplied (project, event) tuple
    /// doesn't match what's on disk.
    async fn get(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
    ) -> Result<Vec<u8>, AttachmentError>;

    /// Delete a single blob. Silent no-op if it doesn't exist.
    async fn delete(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
    ) -> Result<(), AttachmentError>;

    /// Bulk-delete every blob for a (project, event). Called from
    /// the retention sweep when an event partition is dropped.
    async fn delete_event(&self, project_id: Uuid, event_id: Uuid)
        -> Result<(), AttachmentError>;
}

// ───────────────────── local-fs implementation ──────────────────────

pub struct LocalFsAttachmentStore {
    root: PathBuf,
}

impl LocalFsAttachmentStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn dir_for(&self, project_id: Uuid, event_id: Uuid) -> PathBuf {
        self.root.join(project_id.to_string()).join(event_id.to_string())
    }

    fn path_for(&self, project_id: Uuid, event_id: Uuid, ref_id: Uuid) -> PathBuf {
        self.dir_for(project_id, event_id).join(format!("{ref_id}.bin"))
    }
}

#[async_trait]
impl AttachmentStore for LocalFsAttachmentStore {
    async fn put(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
        data: &[u8],
    ) -> Result<(), AttachmentError> {
        let dir = self.dir_for(project_id, event_id);
        tokio::fs::create_dir_all(&dir).await?;
        let path = self.path_for(project_id, event_id, ref_id);
        // Write to a temp file then rename so a crashed write doesn't
        // leave a half-written blob the GET path would then serve.
        let tmp = path.with_extension("bin.tmp");
        tokio::fs::write(&tmp, data).await?;
        tokio::fs::rename(&tmp, &path).await?;
        Ok(())
    }

    async fn get(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
    ) -> Result<Vec<u8>, AttachmentError> {
        let path = self.path_for(project_id, event_id, ref_id);
        match tokio::fs::read(&path).await {
            Ok(data) => Ok(data),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(AttachmentError::NotFound),
            Err(e) => Err(e.into()),
        }
    }

    async fn delete(
        &self,
        project_id: Uuid,
        event_id: Uuid,
        ref_id: Uuid,
    ) -> Result<(), AttachmentError> {
        let path = self.path_for(project_id, event_id, ref_id);
        match tokio::fs::remove_file(&path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    async fn delete_event(
        &self,
        project_id: Uuid,
        event_id: Uuid,
    ) -> Result<(), AttachmentError> {
        let dir = self.dir_for(project_id, event_id);
        match tokio::fs::remove_dir_all(&dir).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}

// ───────────────────── noop implementation ──────────────────────────

pub struct NoopAttachmentStore;

#[async_trait]
impl AttachmentStore for NoopAttachmentStore {
    async fn put(&self, _: Uuid, _: Uuid, _: Uuid, _: &[u8]) -> Result<(), AttachmentError> {
        Err(AttachmentError::Disabled)
    }
    async fn get(&self, _: Uuid, _: Uuid, _: Uuid) -> Result<Vec<u8>, AttachmentError> {
        Err(AttachmentError::NotFound)
    }
    async fn delete(&self, _: Uuid, _: Uuid, _: Uuid) -> Result<(), AttachmentError> {
        Ok(())
    }
    async fn delete_event(&self, _: Uuid, _: Uuid) -> Result<(), AttachmentError> {
        Ok(())
    }
}

// ───────────────────── boxed store helpers ──────────────────────────

pub type SharedAttachmentStore = Arc<dyn AttachmentStore>;

/// Build the store the server runs with. Reads `SENTORI_ATTACHMENT_DIR`
/// — when set, returns `LocalFsAttachmentStore` rooted there; when
/// missing, returns `NoopAttachmentStore` and leaves uploads disabled
/// (the endpoint returns 503 `attachmentsDisabled`).
pub fn build_default_store() -> SharedAttachmentStore {
    match std::env::var("SENTORI_ATTACHMENT_DIR") {
        Ok(dir) if !dir.trim().is_empty() => {
            let path = Path::new(&dir).to_path_buf();
            tracing::info!(dir = %path.display(), "attachment store: local-fs");
            Arc::new(LocalFsAttachmentStore::new(path))
        }
        _ => {
            tracing::warn!(
                "SENTORI_ATTACHMENT_DIR not set — attachment uploads disabled. \
                 Set it to enable screenshots / view trees."
            );
            Arc::new(NoopAttachmentStore)
        }
    }
}

// ────────────────────────────── tests ───────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> tempfile::TempDir {
        tempfile::tempdir().expect("tmpdir")
    }

    #[tokio::test]
    async fn put_then_get_round_trips() {
        let dir = tmpdir();
        let store = LocalFsAttachmentStore::new(dir.path());
        let (p, e, r) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
        store.put(p, e, r, b"hello").await.unwrap();
        assert_eq!(store.get(p, e, r).await.unwrap(), b"hello");
    }

    #[tokio::test]
    async fn get_missing_is_notfound() {
        let dir = tmpdir();
        let store = LocalFsAttachmentStore::new(dir.path());
        let r = store.get(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()).await;
        assert!(matches!(r, Err(AttachmentError::NotFound)));
    }

    #[tokio::test]
    async fn delete_event_removes_everything_for_that_event() {
        let dir = tmpdir();
        let store = LocalFsAttachmentStore::new(dir.path());
        let (p, e) = (Uuid::now_v7(), Uuid::now_v7());
        let (r1, r2) = (Uuid::now_v7(), Uuid::now_v7());
        store.put(p, e, r1, b"a").await.unwrap();
        store.put(p, e, r2, b"b").await.unwrap();

        store.delete_event(p, e).await.unwrap();

        assert!(matches!(store.get(p, e, r1).await, Err(AttachmentError::NotFound)));
        assert!(matches!(store.get(p, e, r2).await, Err(AttachmentError::NotFound)));
    }

    #[tokio::test]
    async fn delete_missing_is_silent() {
        let dir = tmpdir();
        let store = LocalFsAttachmentStore::new(dir.path());
        // Should not error even though nothing exists.
        store
            .delete(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7())
            .await
            .unwrap();
        store
            .delete_event(Uuid::now_v7(), Uuid::now_v7())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn noop_store_rejects_writes() {
        let store = NoopAttachmentStore;
        let r = store
            .put(Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7(), b"x")
            .await;
        assert!(matches!(r, Err(AttachmentError::Disabled)));
    }
}

//! Per-set business-table ETL modules.
//!
//! Each module is a simple `SELECT * FROM <legacy_table>` →
//! transform (workspace_id rename / role mapping) → INSERT INTO
//! <v0.2_table> ON CONFLICT DO NOTHING. Because v0.2's migrations
//! 0016-0030 deliberately reuse legacy column names, the
//! transform layer is mostly identity (just substitute
//! `org_id` → `workspace_id`).

pub mod attachments;
pub mod events;
pub mod issues;
pub mod push;
pub mod releases;
pub mod sessions;
pub mod spans;
pub mod tokens;

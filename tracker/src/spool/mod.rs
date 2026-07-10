//! Local durable spool. Every completed span is written here synchronously
//! (local disk only, never network) before the decoupled ingest flusher
//! (crate::ingest) ever sees it, so capture durability never depends on
//! Convex/network availability. Table shape is exactly the one specified in
//! the contract: spool(sourceId TEXT PK, payload JSON, createdAt, sentAt NULL).

use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use ulid::Ulid;

use crate::category::Category;
use crate::log::Log;

/// Wire DTO posted to POST {CHRONOMAXI_INGEST_URL}/ingest. Field names/casing
/// match the ratified ingest contract exactly.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct IngestRow {
    #[serde(rename = "sourceId")]
    pub source_id: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    pub category: Category,
    #[serde(rename = "isIdle")]
    pub is_idle: bool,
    #[serde(rename = "deviceName")]
    pub device_name: String,
    pub actor: String,
    #[serde(rename = "windowId")]
    pub window_id: String,
    #[serde(rename = "programProcessName")]
    pub program_process_name: String,
    #[serde(rename = "programName")]
    pub program_name: String,
    #[serde(rename = "browserTitle", skip_serializing_if = "Option::is_none")]
    pub browser_title: Option<String>,
    #[serde(rename = "keysPressedCount", skip_serializing_if = "Option::is_none")]
    pub keys_pressed_count: Option<usize>,
    #[serde(rename = "mouseMovementInMM", skip_serializing_if = "Option::is_none")]
    pub mouse_movement_in_mm: Option<f64>,
    #[serde(rename = "leftClickCount", skip_serializing_if = "Option::is_none")]
    pub left_click_count: Option<usize>,
    #[serde(rename = "rightClickCount", skip_serializing_if = "Option::is_none")]
    pub right_click_count: Option<usize>,
    #[serde(rename = "middleClickCount", skip_serializing_if = "Option::is_none")]
    pub middle_click_count: Option<usize>,
    #[serde(rename = "tokensSpent", skip_serializing_if = "Option::is_none")]
    pub tokens_spent: Option<f64>,
}

impl IngestRow {
    fn from_log(log: &Log, device_name: &str) -> Self {
        Self {
            source_id: Ulid::new().to_string(),
            created_at: log.created_at.unwrap_or_else(Utc::now).timestamp_millis(),
            duration_ms: log.duration_ms.unwrap_or(0),
            category: log.category.clone().unwrap_or(Category::Other),
            is_idle: log.is_idle,
            device_name: device_name.to_string(),
            actor: log.actor.clone(),
            window_id: log.current_window_id.clone().unwrap_or_else(|| "unknown".to_string()),
            program_process_name: log
                .current_program_process_name
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            program_name: log.current_program_name.clone().unwrap_or_else(|| "unknown".to_string()),
            browser_title: log.current_browser_title.clone(),
            keys_pressed_count: log.keys_pressed_count,
            mouse_movement_in_mm: log.mouse_movement_mm,
            left_click_count: log.left_click_count,
            right_click_count: log.right_click_count,
            middle_click_count: log.middle_click_count,
            tokens_spent: None,
        }
    }
}

pub struct Spool {
    conn: Connection,
}

impl Spool {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "busy_timeout", 5000)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS spool (
                sourceId TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                sentAt TEXT
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_spool_pending ON spool (sentAt, createdAt)",
            [],
        )?;

        Ok(Self { conn })
    }

    /// Builds the wire row from a just-completed span and durably inserts it.
    /// Local-disk only -- never blocks on network.
    pub fn enqueue(&self, log: &Log, device_name: &str) -> Result<(), Box<dyn std::error::Error>> {
        let row = IngestRow::from_log(log, device_name);
        let payload = serde_json::to_string(&row)?;
        let created_at = Utc::now().to_rfc3339();

        self.conn.execute(
            "INSERT OR IGNORE INTO spool (sourceId, payload, createdAt, sentAt) VALUES (?1, ?2, ?3, NULL)",
            params![row.source_id, payload, created_at],
        )?;

        Ok(())
    }

    /// Oldest-first, unsent rows, up to `limit`. Returns (sourceId, payload).
    pub fn claim_batch(&self, limit: usize) -> rusqlite::Result<Vec<(String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT sourceId, payload FROM spool WHERE sentAt IS NULL ORDER BY createdAt ASC LIMIT ?1")?;

        let rows = stmt
            .query_map(params![limit as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn mark_sent(&self, source_ids: &[String]) -> rusqlite::Result<()> {
        if source_ids.is_empty() {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();
        let placeholders = source_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("UPDATE spool SET sentAt = ? WHERE sourceId IN ({placeholders})");

        let mut stmt = self.conn.prepare(&sql)?;
        let mut param_values: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(source_ids.len() + 1);
        param_values.push(&now);
        for id in source_ids {
            param_values.push(id);
        }
        stmt.execute(param_values.as_slice())?;

        Ok(())
    }

    /// Deletes sent rows older than `cutoff` (by spool-insert time, not span
    /// time). Pending rows are never pruned regardless of age.
    pub fn prune_sent_older_than(&self, cutoff: DateTime<Utc>) -> rusqlite::Result<usize> {
        self.conn.execute(
            "DELETE FROM spool WHERE sentAt IS NOT NULL AND createdAt < ?1",
            params![cutoff.to_rfc3339()],
        )
    }

    pub fn pending_count(&self) -> rusqlite::Result<i64> {
        self.conn
            .query_row("SELECT COUNT(*) FROM spool WHERE sentAt IS NULL", [], |row| row.get(0))
    }
}

//! Decoupled spool-to-Convex flusher. Runs as its own tokio task with its own
//! sqlite connection to the spool file; capture/spooling on the main task
//! never waits on this. On failure the whole batch stays pending and is
//! retried with exponential backoff (5s doubling, capped 5min); on success
//! the batch is marked sentAt in one UPDATE. Convex dedupes by sourceId, so a
//! stale retry after a successful-but-unobserved response is always safe.

use std::time::Duration;

use chrono::Utc;

use crate::config::{Configuration, SPOOL_BATCH_SIZE};
use crate::spool::Spool;

const POLL_INTERVAL: Duration = Duration::from_secs(10);
const PRUNE_INTERVAL: chrono::Duration = chrono::Duration::seconds(60 * 60);
const RETENTION: chrono::Duration = chrono::Duration::days(7);
const MIN_BACKOFF: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(5 * 60);

struct IngestClient {
    http: reqwest::Client,
    base_url: String,
    secret: String,
}

impl IngestClient {
    fn new(base_url: String, secret: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { http, base_url, secret }
    }

    async fn send_batch(&self, rows: &[serde_json::Value]) -> Result<(), String> {
        let url = format!("{}/ingest", self.base_url.trim_end_matches('/'));
        let body = serde_json::json!({ "batch": rows });

        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.secret)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("ingest returned status {}", response.status()))
        }
    }
}

/// Spawned once from main.rs. Never panics, never returns on the happy path
/// (only exits early if the spool file itself cannot be opened, since that
/// indicates a filesystem-level problem the capture side would also hit).
pub async fn run_flusher(config: Configuration) {
    let spool = match Spool::open(&config.spool_path) {
        Ok(spool) => spool,
        Err(e) => {
            println!("chronomaxi ingest: failed to open spool at {:?}: {:?}", config.spool_path, e);
            return;
        }
    };

    let client = IngestClient::new(config.ingest_url.clone(), config.ingest_secret.clone());
    let mut backoff = MIN_BACKOFF;
    let mut last_prune = Utc::now();

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;

        match spool.claim_batch(SPOOL_BATCH_SIZE) {
            Ok(rows) if rows.is_empty() => {
                backoff = MIN_BACKOFF;
            }
            Ok(rows) => {
                let source_ids: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
                let values: Vec<serde_json::Value> = rows
                    .iter()
                    .filter_map(|(_, payload)| serde_json::from_str::<serde_json::Value>(payload).ok())
                    .collect();

                match client.send_batch(&values).await {
                    Ok(()) => {
                        if let Err(e) = spool.mark_sent(&source_ids) {
                            println!("chronomaxi ingest: failed to mark {} rows sent: {:?}", source_ids.len(), e);
                        } else {
                            println!("chronomaxi ingest: flushed {} rows", source_ids.len());
                        }
                        backoff = MIN_BACKOFF;
                    }
                    Err(e) => {
                        println!(
                            "chronomaxi ingest: send failed ({}), {} rows stay pending, retrying in {:?}",
                            e,
                            source_ids.len(),
                            backoff
                        );
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(MAX_BACKOFF);
                    }
                }
            }
            Err(e) => {
                println!("chronomaxi ingest: claim_batch error: {:?}", e);
            }
        }

        if Utc::now() - last_prune >= PRUNE_INTERVAL {
            let cutoff = Utc::now() - RETENTION;
            match spool.prune_sent_older_than(cutoff) {
                Ok(n) if n > 0 => println!("chronomaxi ingest: pruned {n} sent rows older than 7 days"),
                Ok(_) => {}
                Err(e) => println!("chronomaxi ingest: prune error: {:?}", e),
            }
            last_prune = Utc::now();
        }
    }
}

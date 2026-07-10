use crate::config::Configuration;
use crate::log::Log;
use chrono::Utc;
use rusqlite::{params, Connection as SqliteConnection};
use std::{env, path::PathBuf};
use tokio_postgres::{Client, NoTls};
use uuid::Uuid;

pub enum DbType {
    Sqlite(SqliteConnection),
    Postgres(Client),
}

pub struct DbConnection {
    pub conn: DbType,
}

impl DbConnection {
    pub async fn new(config: &Configuration) -> Result<Self, Box<dyn std::error::Error>> {
        if let Some(url) = &config.database_url {
            if url.starts_with("postgres") {
                let (client, connection) = tokio_postgres::connect(url, NoTls).await?;
                tokio::spawn(async move {
                    if let Err(e) = connection.await {
                        eprintln!("connection error: {}", e);
                    }
                });
                println!("Connected to PostgreSQL database");
                return Ok(DbConnection {
                    conn: DbType::Postgres(client),
                });
            }
        }

        let db_path = sqlite_db_path();
        let conn = SqliteConnection::open(&db_path)?;
        println!("Connected to SQLite database at {}", db_path.display());
        Ok(DbConnection {
            conn: DbType::Sqlite(conn),
        })
    }

    pub async fn bulk_insert_logs(
        &mut self,
        logs: &Vec<Log>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        match &mut self.conn {
            DbType::Sqlite(conn) => Self::bulk_insert_sqlite(conn, logs),
            DbType::Postgres(client) => Self::bulk_insert_postgres(client, logs).await,
        }
    }

    fn bulk_insert_sqlite(
        conn: &mut SqliteConnection,
        logs: &Vec<Log>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let device_name = whoami::devicename();
        let tx = conn.transaction()?;
        for log in logs {
            let created_at = log.created_at.unwrap_or_else(Utc::now).to_rfc3339();
            tx.execute(
                "INSERT INTO Log (id, createdAt, updatedAt, durationMs, category, isIdle, deviceName, windowId, programProcessName, programName, browserTitle, keysPressedCount, mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    Uuid::new_v4().to_string(),
                    created_at,
                    created_at,
                    log.duration_ms.unwrap_or(0),
                    log.category.as_ref().map_or("Unknown".to_string(), |c| format!("{:?}", c)),
                    log.is_idle,
                    device_name,
                    log.current_window_id,
                    log.current_program_process_name,
                    log.current_program_name,
                    log.current_browser_title,
                    log.keys_pressed_count.map(|v| v as i32),
                    log.mouse_movement_mm,
                    log.left_click_count.map(|v| v as i32),
                    log.right_click_count.map(|v| v as i32),
                    log.middle_click_count.map(|v| v as i32),
                ],
            )?;
        }
        tx.commit()?;
        Ok(true)
    }

    async fn bulk_insert_postgres(
        client: &mut Client,
        logs: &Vec<Log>,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let device_name = whoami::devicename();
        let transaction = client.transaction().await?;

        for log in logs {
            let created_at = log.created_at.unwrap_or_else(Utc::now).naive_utc();
            transaction.execute(
            "INSERT INTO \"Log\" (id, \"createdAt\", \"updatedAt\", \"durationMs\", category, \"isIdle\", \"deviceName\", \"windowId\", \"programProcessName\", \"programName\", \"browserTitle\", \"keysPressedCount\", \"mouseMovementInMM\", \"leftClickCount\", \"rightClickCount\", \"middleClickCount\") 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
            &[
                &Uuid::new_v4().to_string(),
                &created_at,
                &created_at,
                &(log.duration_ms.unwrap_or(0) as i32),
                &log.category.as_ref().map_or("Unknown".to_string(), |c| format!("{:?}", c)),
                &log.is_idle,
                &device_name,
                &log.current_window_id,
                &log.current_program_process_name,
                &log.current_program_name,
                &log.current_browser_title,
                &log.keys_pressed_count.map(|v| v as i32),
                &log.mouse_movement_mm,
                &log.left_click_count.map(|v| v as i32),
                &log.right_click_count.map(|v| v as i32),
                &log.middle_click_count.map(|v| v as i32),
            ],
        ).await?;
        }
        transaction.commit().await?;
        Ok(true)
    }
}

fn sqlite_db_path() -> PathBuf {
    if let Ok(path) = env::var("CHRONOMAXI_DB_PATH") {
        if !path.trim().is_empty() {
            return PathBuf::from(path);
        }
    }

    let relative_path = PathBuf::from("../frontend/prisma/db.sqlite");
    if relative_path.exists() {
        return relative_path;
    }

    env::var("HOME")
        .map(PathBuf::from)
        .map(|home| home.join("personal/chronomaxi/frontend/prisma/db.sqlite"))
        .unwrap_or(relative_path)
}

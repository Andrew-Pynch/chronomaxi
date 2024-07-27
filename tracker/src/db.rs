use crate::config::Configuration;
use crate::log::Log;
use rusqlite::{params, Connection as SqliteConnection};
use tokio_postgres::{Client, NoTls};
use uuid::Uuid;
use whoami;

pub enum DbType {
    Sqlite(SqliteConnection),
    Postgres(Client),
}

pub struct DbConnection {
    pub conn: DbType,
}

impl DbConnection {
    pub async fn new(config: &Configuration) -> Result<Self, Box<dyn std::error::Error>> {
        match &config.database_url {
            Some(url) => {
                // PostgreSQL connection
                let (client, connection) = tokio_postgres::connect(url, NoTls).await?;
                tokio::spawn(async move {
                    if let Err(e) = connection.await {
                        eprintln!("connection error: {}", e);
                    }
                });
                println!("Connected to PostgreSQL database");
                Ok(DbConnection {
                    conn: DbType::Postgres(client),
                })
            }
            None => {
                // SQLite connection (fallback)
                let db_path = "../frontend/prisma/db.sqlite";
                let conn = SqliteConnection::open(db_path)?;
                println!("Connected to SQLite database");
                Ok(DbConnection {
                    conn: DbType::Sqlite(conn),
                })
            }
        }
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
            tx.execute(
                "INSERT INTO Log (id, createdAt, updatedAt, durationMs, category, isIdle, deviceName, windowId, programProcessName, programName, browserTitle, keysPressedCount, mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    Uuid::new_v4().to_string(),
                    log.created_at.unwrap().to_rfc3339(),
                    log.created_at.unwrap().to_rfc3339(),
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
            let created_at = log.created_at.unwrap().naive_utc();
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

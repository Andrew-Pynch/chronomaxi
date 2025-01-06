use crate::config::Configuration;
use crate::log::Log;
use chrono::Utc;
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
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        match &mut self.conn {
            DbType::Sqlite(conn) => Self::bulk_insert_sqlite(conn, logs),
            DbType::Postgres(client) => Self::bulk_insert_postgres(client, logs).await,
        }
    }

    fn bulk_insert_sqlite(
        conn: &mut SqliteConnection,
        logs: &Vec<Log>,
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let device_name = whoami::devicename();
        let tx = conn.transaction()?;
        let mut last_id = None;

        for log in logs {
            // Generate UUID for this log
            let log_id = Uuid::new_v4().to_string();
            last_id = Some(log_id.clone());

            tx.execute(
                "INSERT INTO Log (
            id, createdAtMinutes, startTimeMinutes, endTimeMinutes, 
            durationMinutes, category, isIdle, deviceName, windowId, 
            programProcessName, programName, browserTitle, keysPressedCount, 
            mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
        )",
                params![
                    log_id,
                    log.created_at_minutes.unwrap_or(0),
                    log.start_time_minutes.unwrap_or(0),
                    log.end_time_minutes.unwrap_or(0),
                    log.duration_minutes.unwrap_or(0),
                    log.category
                        .as_ref()
                        .map_or("Unknown".to_string(), |c| format!("{:?}", c)),
                    log.is_idle,
                    device_name,
                    log.current_window_id,
                    log.current_program_process_name,
                    log.current_program_name,
                    log.current_browser_title,
                    log.keys_pressed_count,
                    log.mouse_movement_mm,
                    log.left_click_count,
                    log.right_click_count,
                    log.middle_click_count,
                ],
            )?;
        }
        tx.commit()?;
        Ok(last_id)
    }

    async fn bulk_insert_postgres(
        client: &mut Client,
        logs: &Vec<Log>,
    ) -> Result<Option<String>, Box<dyn std::error::Error>> {
        let device_name = whoami::devicename();
        let transaction = client.transaction().await?;
        let mut last_id = None;

        for log in logs {
            // Generate UUID for this log
            let log_id = Uuid::new_v4().to_string();
            last_id = Some(log_id.clone());

            transaction
                .execute(
                    "INSERT INTO \"Log\" (
            id, \"createdAtMinutes\", \"startTimeMinutes\", \"endTimeMinutes\", 
            \"durationMinutes\", category, \"isIdle\", \"deviceName\", \"windowId\", 
            \"programProcessName\", \"programName\", \"browserTitle\", \"keysPressedCount\", 
            \"mouseMovementInMM\", \"leftClickCount\", \"rightClickCount\", \"middleClickCount\"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
                    &[
                        &log_id,
                        &(log.created_at_minutes.unwrap_or(0) as i64),
                        &(log.start_time_minutes.unwrap_or(0) as i64),
                        &(log.end_time_minutes.unwrap_or(0) as i64),
                        &(log.duration_minutes.unwrap_or(0) as i32),
                        &log.category
                            .as_ref()
                            .map_or("Unknown".to_string(), |c| format!("{:?}", c)),
                        &log.is_idle,
                        &device_name,
                        &log.current_window_id,
                        &log.current_program_process_name,
                        &log.current_program_name,
                        &log.current_browser_title,
                        &log.keys_pressed_count,
                        &log.mouse_movement_mm,
                        &log.left_click_count,
                        &log.right_click_count,
                        &log.middle_click_count,
                    ],
                )
                .await?;
        }
        transaction.commit().await?;
        Ok(last_id)
    }

    pub async fn insert_screenshot_classification(
        &mut self,
        log_id: &str,
        screenshot_path: &str,
        raw_response: &str,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        match &mut self.conn {
            DbType::Sqlite(conn) => {
                // Parse the OpenAI response
                let response: serde_json::Value = serde_json::from_str(raw_response)?;

                // Extract the JSON content from the message content
                let content = response["choices"][0]["message"]["content"]
                    .as_str()
                    .ok_or("Failed to get content")?;

                // The content is a string containing JSON markdown, need to remove the markdown
                let json_str = content
                    .trim()
                    .trim_start_matches("```json")
                    .trim_end_matches("```")
                    .trim();

                // Now parse the actual classification JSON
                let classification: serde_json::Value = serde_json::from_str(json_str)?;

                let primary_application = classification["primary_application"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let activity_type = classification["activity_type"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let specific_activity = classification["specific_activity"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string();
                let confidence_score = classification["confidence_score"].as_f64().unwrap_or(0.0);

                println!(
                    "Inserting classification: {} - {} - {}",
                    primary_application, activity_type, specific_activity
                );

                let tx = conn.transaction()?;
                tx.execute(
                    "INSERT INTO ScreenshotClassification (
                    id, createdAt, screenshotPath, primaryApplication, activityType,
                    specificActivity, confidenceScore, rawResponse, logId
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
                )",
                    params![
                        Uuid::new_v4().to_string(),
                        Utc::now().timestamp(),
                        screenshot_path,
                        primary_application,
                        activity_type,
                        specific_activity,
                        confidence_score,
                        raw_response,
                        log_id,
                    ],
                )?;
                tx.commit()?;
                Ok(true)
            }
            DbType::Postgres(_) => {
                // Add Postgres implementation if needed
                Ok(true)
            }
        }
    }
}

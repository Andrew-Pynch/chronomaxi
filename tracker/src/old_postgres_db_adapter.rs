use crate::log::Log;
use chrono::{DateTime, NaiveDateTime, Utc};
use std::{collections::HashMap, env};
use tokio_postgres::{types::ToSql, Client, NoTls};
use uuid::Uuid;
use whoami;

pub struct DbConnectionPostgres {
    client: Client,
}

impl DbConnectionPostgres {
    pub async fn new() -> Result<Self, tokio_postgres::Error> {
        let db_url = env::var("DB_URL").expect("DB_URL must be set");
        let (client, connection) = tokio_postgres::connect(&db_url, NoTls).await?;

        // Spawn a background task to handle the connection
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("Connection error: {}", e);
            }
        });

        Ok(DbConnectionPostgres { client })
    }

    pub async fn bulk_insert_logs(&self, logs: &Vec<Log>) -> Result<bool, tokio_postgres::Error> {
        let device_name = whoami::devicename();

        let keys_pressed: HashMap<usize, i32> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.keys_pressed_count.unwrap_or(0) as i32))
            .collect();

        let durations: HashMap<usize, f64> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.duration_ms.unwrap_or(0.0) as f64))
            .collect();

        let insert_ids: HashMap<usize, String> = logs
            .iter()
            .enumerate()
            .map(|(index, _)| (index, Uuid::new_v4().to_string()))
            .collect();

        let created_at_natives: HashMap<usize, NaiveDateTime> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.created_at.unwrap().naive_utc()))
            .collect();

        let params: Vec<&(dyn ToSql + Sync)> = logs
            .iter()
            .enumerate()
            .flat_map(|(index, log)| {
                vec![
                    &insert_ids[&index] as &(dyn ToSql + Sync),
                    &log.user_id,
                    &durations[&index],
                    &device_name,
                    &log.current_window_id,
                    &log.current_program_process_name,
                    &log.current_program_name,
                    &log.current_browser_title,
                    &keys_pressed[&index],
                    &created_at_natives[&index],
                    &created_at_natives[&index],
                ]
            })
            .collect();

        let query = format!(
        "INSERT INTO \"Log\" (id, \"userId\", \"durationMs\", \"deviceName\", \"windowId\", \"programProcessName\", \"programName\", \"browserTitle\", \"keysPressedCount\", \"createdAt\", \"updatedAt\") VALUES {}",
        (1..=params.len())
            .step_by(11)
            .map(|i| format!("(${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${})", i, i+1, i+2, i+3, i+4, i+5, i+6, i+7, i+8, i+9, i+10))
            .collect::<Vec<_>>()
            .join(", ")
    );

        println!("Query: {}", query);
        println!("Params: {:?}", params);

        self.client.execute(&query, &params).await?;

        println!("Inserted {} logs", logs.len());

        Ok(true)
    }
}

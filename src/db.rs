use crate::log::Log;
use chrono::{DateTime, NaiveDateTime, Utc};
use std::{collections::HashMap, env};
use tokio_postgres::{types::ToSql, Client, NoTls};
use uuid::Uuid;
use whoami;

#[derive(Debug, Clone)]
pub struct DbConnection {
    client: Client,
}

impl DbConnection {
    pub async fn new() -> Result<Self, tokio_postgres::Error> {
        let db_url = env::var("DB_URL").expect("DB_URL must be set");
        let (client, connection) = tokio_postgres::connect(&db_url, NoTls).await?;

        // Spawn a background task to handle the connection
        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("Connection error: {}", e);
            }
        });

        Ok(DbConnection { client })
    }

    pub async fn get_google_oauth_config(
        &self,
    ) -> Result<Option<GoogleOAuthConfig>, tokio_postgres::Error> {
        let row = self.client
            .query_one("SELECT google_client_id, google_client_secret, redirect_uri FROM oauth_configuration LIMIT 1", &[])
            .await?;

        let google_client_id: String = row.get(0);
        let google_client_secret: String = row.get(1);
        let redirect_uri: String = row.get(2);

        Ok(Some(GoogleOAuthConfig {
            google_client_id,
            google_client_secret,
            redirect_uri,
        }))
    }

    pub async fn is_api_key_valid(&self, key: &str) -> Result<bool, tokio_postgres::Error> {
        let current_pc_name = whoami::devicename();

        // Check if the API key exists and belongs to a user
        let row = self
            .client
            .query_opt(
                "SELECT id, name, key FROM \"APIKey\" WHERE key = $1",
                &[&key],
            )
            .await?;

        if let Some(row) = row {
            let api_key_id: String = row.get(0);

            let connected_device = self
                .client
                .query_opt(
                    "SELECT name FROM \"Device\" WHERE \"apiKeyId\" = $1",
                    &[&api_key_id],
                )
                .await?;

            if let Some(device_row) = connected_device {
                let device_name: String = device_row.get(0);
                println!("Connected Device: {:?}", device_name);

                // Check if the device name matches the current PC name
                if device_name == current_pc_name {
                    return Ok(true);
                } else {
                    return Ok(false);
                }
            } else {
                // If there are no connected devices, add the current device to the database
                self.client
                .execute(
                    "INSERT INTO \"Device\" (id, name, \"apiKeyId\", \"computerName\", \"createdAt\", \"updatedAt\") VALUES (uuid_generate_v4(), $1, $2, $3, now(), now())",
                    &[&current_pc_name, &api_key_id, &current_pc_name],
                )
                .await?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub async fn get_user_from_api_key(&self, key: &str) -> Result<String, tokio_postgres::Error> {
        let row = self
            .client
            .query_opt("SELECT \"userId\" FROM \"APIKey\" WHERE key = $1", &[&key])
            .await?;

        if let Some(row) = row {
            let user_id: String = row.get(0);
            return Ok(user_id);
        }

        Ok("".to_string())
    }

    pub async fn bulk_insert_logs(&self, logs: &Vec<Log>) -> Result<bool, tokio_postgres::Error> {
        let device_name = whoami::devicename();

        let keys_pressed: HashMap<usize, i32> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.keys_pressed_count.unwrap_or(0) as i32))
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
        "INSERT INTO \"Log\" (id, \"userId\", \"deviceName\", \"windowId\", \"programProcessName\", \"programName\", \"browserTitle\", \"keysPressedCount\", \"createdAt\", \"updatedAt\") VALUES {}",
        (1..=params.len())
            .step_by(10)
            .map(|i| format!("(${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${}, ${})", i, i+1, i+2, i+3, i+4, i+5, i+6, i+7, i+8, i+9))
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

pub struct GoogleOAuthConfig {
    pub google_client_id: String,
    pub google_client_secret: String,
    pub redirect_uri: String,
}

pub struct APIKey {
    pub id: String,
    pub key: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub user_id: String,
}

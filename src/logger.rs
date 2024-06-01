use crate::config::{Configuration, LogMethod};
use crate::program_tracking::get_program_name;
use crate::types::{ActivityLog, ProgramUsage};
use chrono::{prelude::*, TimeDelta};
use device_query::{DeviceQuery, DeviceState};
use dotenv::dotenv;
use rusqlite::{params, Connection as SqliteConnection};
use sqlx::postgres::PgPool;
use std::collections::HashMap;
use std::env;
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

pub struct Logger {
    config: Configuration,
    idle_threshold: TimeDelta,
}

struct LoggerThreadData {
    config: Configuration,
    idle_threshold: TimeDelta,
}

impl LoggerThreadData {
    pub fn log(&self, is_idle: &mut bool) -> Option<ActivityLog> {
        let start_time = Utc::now();
        let end_time = start_time + chrono::Duration::seconds(10);
        let device_state = DeviceState::new();
        let mut total_key_presses = 0;
        let mut programs_usage = HashMap::new();
        let mut last_window_id = String::new();
        let mut last_program_name = String::new();
        let mut last_mouse_position = (0, 0);

        while Utc::now() < end_time {
            thread::sleep(Duration::from_millis(100));

            // Get current active window ID
            let window_id = Command::new("xdotool")
                .arg("getactivewindow")
                .output()
                .unwrap()
                .stdout;
            let window_id_str = String::from_utf8(window_id).unwrap().trim().to_string();

            // Get key press frequencies
            let keys_pressed = device_state.get_keys();

            let mouse_position = device_state.get_mouse().coords;

            // Check if there is any activity (key presses or window focus change or mouse movement)
            let is_active = !keys_pressed.is_empty()
                || window_id_str != last_window_id
                || mouse_position != last_mouse_position;

            // Update idle status based on activity
            if is_active {
                *is_idle = false;
            }

            // Track program usage
            if let Ok(Some(program_name)) = get_program_name(&window_id_str) {
                let entry = programs_usage.entry(program_name.clone()).or_insert(0);
                *entry += 1; // Increment the duration by 1 for each loop iteration
                last_program_name = program_name;
            }

            total_key_presses += keys_pressed.len();
            last_window_id = window_id_str;

            // Check if the system is idle
            if *is_idle {
                return None;
            }

            last_mouse_position = mouse_position;
        }

        // Add 600ms of extra duration to the last program
        if let Some(duration) = programs_usage.get_mut(&last_program_name) {
            *duration += 6;
        }

        // Convert program usage into vector for ActivityLog
        let programs: Vec<ProgramUsage> = programs_usage
            .into_iter()
            .map(|(name, duration)| ProgramUsage {
                id: uuid::Uuid::new_v4().to_string(),
                activity_log_id: String::new(),
                program_name: name,
                duration: duration * 100, // Convert loop iterations to milliseconds
            })
            .collect();

        Some(ActivityLog {
            id: uuid::Uuid::new_v4().to_string(),
            created_at: start_time,
            updated_at: start_time,
            user_id: String::new(),
            programs,
            total_key_presses: total_key_presses as i32,
        })
    }
}

impl Logger {
    pub fn new(config: Configuration) -> Self {
        Logger {
            config,
            idle_threshold: TimeDelta::minutes(1),
        }
    }

    pub fn start_tracking(&self, tx: mpsc::Sender<()>) {
        let thread_data = LoggerThreadData {
            config: self.config.clone(),
            idle_threshold: self.idle_threshold,
        };

        let user_id = "clwlg6uzm0000csepmacwqrq3";

        println!("Starting keypress and program usage tracker...");

        let mut last_activity_time = Utc::now();
        let mut is_idle = false;

        thread::spawn(move || {
            let runtime = tokio::runtime::Runtime::new().unwrap(); 

            loop {
                let activity_log = thread_data.log(&mut is_idle);

                // Check for idle status
                let current_idle_status = is_idle;
                let is_active = activity_log
                    .as_ref()
                    .map_or(false, |log| log.total_key_presses > 0);

                if is_active {
                    last_activity_time = Utc::now();
                    is_idle = false;
                } else {
                    let idle_duration = Utc::now() - last_activity_time;
                    if idle_duration >= thread_data.idle_threshold {
                        is_idle = true;
                    }
                    println!("Idle timer: {} seconds", idle_duration.num_seconds());
                }

                if current_idle_status == false && is_idle == true {
                    println!("System is idle, no key presses detected and window focus remained the same...");
                } else if current_idle_status == true && is_idle == false {
                    println!(
                        "System is no longer idle, key presses detected or screen focus changed..."
                    );
                }

                // Handle the activity log based on the configured log methods
                if let Some(log) = activity_log {
                    if current_idle_status == false && is_idle == true {
                        println!("System is idle, skipping activity log...");
                        continue;
                    }

                    for log_method in &thread_data.config.log_methods {
                        match log_method {
                            LogMethod::Stdout => {
                                println!("Activity Log: {:?}", log);
                            }
                            LogMethod::File => {
                                // Implement file logging for the activity log
                                // ...
                            }
                            LogMethod::Db => {
                                if let Err(e) = runtime.block_on(Logger::log_to_db(&log, &log.programs, user_id)) {
                                    eprintln!("Error logging to DB: {}", e);
                                }
                            }
                        }
                    }
                }

                // Send a signal to the main thread to keep it alive
                tx.send(()).unwrap();
            }
        });
    }

    async fn log_to_db(
        activity_log: &ActivityLog,
        programs: &[ProgramUsage],
        user_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        dotenv().ok();
        let db_mode = env::var("DB_MODE").unwrap_or_else(|_| "sqlite".to_string());

        println!("Logging to DB with mode: {}", db_mode);

        match db_mode.as_str() {
            "sqlite" => Logger::log_to_sqlite(activity_log, programs, user_id),
            "postgres" => Logger::log_to_postgres(activity_log, programs, user_id).await,
            _ => Err(format!("Invalid DB_MODE: {}", db_mode).into()),
        }
    }

    fn log_to_sqlite(
        activity_log: &ActivityLog,
        programs: &[ProgramUsage],
        user_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let sqlite_file_path = env::var("SQLITE_FILE_PATH")
            .unwrap_or_else(|_| "../frontend/prisma/db.sqlite".to_string());
        let conn = SqliteConnection::open(&sqlite_file_path)?;

        // Insert activity log and handle errors
        conn.execute(
            "INSERT INTO ActivityLog (id, createdAt, updatedAt, userId, totalKeyPresses) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                activity_log.id,
                activity_log.created_at.to_rfc3339(),
                activity_log.updated_at.to_rfc3339(),
                user_id,
                activity_log.total_key_presses,
            ],
        )?;

        // Insert program usages and handle errors
        for program in programs {
            conn.execute(
                "INSERT INTO ProgramUsage (id, activityLogId, programName, duration) VALUES (?1, ?2, ?3, ?4)",
                params![
                    program.id,
                    activity_log.id,
                    program.program_name,
                    program.duration,
                ],
            )?;
        }

        // Debug output
        println!("\n\nData inserted successfully into SQLite");

        Ok(())
    }

    async fn log_to_postgres(
        activity_log: &ActivityLog,
        programs: &[ProgramUsage],
        user_id: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let postgres_url = env::var("DB_URL")?;
        let pool = PgPool::connect(&postgres_url).await?;

        // Insert activity log using a prepared statement
        let activity_log_query = "INSERT INTO \"ActivityLog\" (\"id\", \"createdAt\", \"updatedAt\", \"userId\", \"totalKeyPresses\") VALUES ($1, $2, $3, $4, $5)";
        sqlx::query(activity_log_query)
            .bind(&activity_log.id)
            .bind(activity_log.created_at)
            .bind(activity_log.updated_at)
            .bind(user_id)
            .bind(activity_log.total_key_presses)
            .execute(&pool)
            .await?;

        // Insert program usages using a prepared statement
        let program_usage_query = "INSERT INTO \"ProgramUsage\" (\"id\", \"activityLogId\", \"programName\", \"duration\") VALUES ($1, $2, $3, $4)";
        for program in programs {
            sqlx::query(program_usage_query)
                .bind(&program.id)
                .bind(&activity_log.id)
                .bind(&program.program_name)
                .bind(program.duration)
                .execute(&pool)
                .await?;
        }

        // Debug output
        println!("\n\nData inserted successfully into PostgreSQL");

        Ok(())
    }
}

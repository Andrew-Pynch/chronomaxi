use crate::log::Log;
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{params, Connection, Transaction};
use std::{collections::HashMap, env};
use uuid::Uuid;
use whoami;

pub struct DbConnection {
    pub conn: Connection,
}

impl DbConnection {
    pub fn new() -> Result<Self, rusqlite::Error> {
        let db_path = "../frontend/prisma/db.sqlite";
        let conn = Connection::open(db_path)?;
        Ok(DbConnection { conn })
    }

    pub fn bulk_insert_logs(&mut self, logs: &Vec<Log>) -> Result<bool, rusqlite::Error> {
        let device_name = whoami::devicename();
        let keys_pressed: HashMap<usize, i32> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.keys_pressed_count.unwrap_or(0) as i32))
            .collect();
        let durations: HashMap<usize, f64> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.duration_ms.unwrap_or(0) as f64))
            .collect();
        let insert_ids: HashMap<usize, String> = logs
            .iter()
            .enumerate()
            .map(|(index, _)| (index, Uuid::new_v4().to_string()))
            .collect();
        let created_at_natives: HashMap<usize, String> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.created_at.unwrap().to_rfc3339()))
            .collect();
        let is_idles: HashMap<usize, bool> = logs
            .iter()
            .enumerate()
            .map(|(index, log)| (index, log.is_idle))
            .collect();

        let tx = self.conn.transaction()?;

        for (index, log) in logs.iter().enumerate() {
            tx.execute(
                "INSERT INTO \"Log\" (id, \"durationMs\", \"deviceName\", \"windowId\", \"programProcessName\", \"programName\", \"browserTitle\", \"keysPressedCount\", \"createdAt\", \"updatedAt\", \"isIdle\") VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    &insert_ids[&index],
                    &durations[&index],
                    &device_name,
                    &log.current_window_id,
                    &log.current_program_process_name,
                    &log.current_program_name,
                    &log.current_browser_title,
                    &keys_pressed[&index],
                    &created_at_natives[&index],
                    &created_at_natives[&index],
                    &is_idles[&index],
                ],
            )?;
        }

        tx.commit()?;

        Ok(true)
    }
}

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
        let tx = self.conn.transaction()?;

        for log in logs {
            tx.execute(
            "INSERT INTO Log (id, createdAt, updatedAt, durationMs, category, isIdle, deviceName, windowId, programProcessName, programName, browserTitle, keysPressedCount, mouseMovementInMM, leftClickCount, rightClickCount, middleClickCount) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                Uuid::new_v4().to_string(),
                log.created_at.unwrap().to_rfc3339(),
                log.created_at.unwrap().to_rfc3339(), // Using createdAt for updatedAt as well
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
}

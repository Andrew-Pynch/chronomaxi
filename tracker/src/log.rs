use crate::category::Category;
use chrono::{DateTime, Utc};
use std::fmt::{self, Formatter};

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct Log {
    pub id: Option<String>,

    pub current_window_id: Option<String>,
    pub current_program_process_name: Option<String>,
    pub current_program_name: Option<String>,
    pub current_browser_title: Option<String>,
    pub current_mouse_position: Option<(i32, i32)>,

    // Use i64 to store minutes since epoch instead of DateTime
    pub created_at_minutes: Option<i64>,
    pub start_time_minutes: Option<i64>,
    pub end_time_minutes: Option<i64>,

    // Use i32 instead of usize/f64 for better memory efficiency
    pub duration_minutes: Option<i32>,
    pub keys_pressed_count: Option<i32>,
    pub mouse_movement_mm: Option<i32>,
    pub left_click_count: Option<i32>,
    pub right_click_count: Option<i32>,
    pub middle_click_count: Option<i32>,

    pub category: Option<Category>,
    pub is_idle: bool,
}

impl fmt::Display for Log {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let (mouse_x, mouse_y) = self.current_mouse_position.unwrap_or((0, 0));
        write!(
            f,
            "ID: {:?}\n\
            Window ID: {:?}\n\
            Program Process Name: {:?}\n\
            Program Name: {:?}\n\
            Browser Title: {:?}\n\
            Mouse Position: ({:?}, {:?})\n\
            Duration Minutes: {:?}\n\
            Keys Pressed: {:?}\n\
            Created At (minutes since epoch): {:?}\n\
            Start Time (minutes since epoch): {:?}\n\
            End Time (minutes since epoch): {:?}\n\
            Is Idle: {:?}\n\
            Category: {:?}\n\
            Mouse Movement (mm): {:?}\n\
            Left Clicks: {:?}\n\
            Right Clicks: {:?}\n\
            Middle Clicks: {:?}",
            self.id,
            self.current_window_id,
            self.current_program_process_name,
            self.current_program_name,
            self.current_browser_title,
            mouse_x,
            mouse_y,
            self.duration_minutes,
            self.keys_pressed_count,
            self.created_at_minutes,
            self.start_time_minutes,
            self.end_time_minutes,
            self.is_idle,
            self.category,
            self.mouse_movement_mm,
            self.left_click_count,
            self.right_click_count,
            self.middle_click_count
        )
    }
}

impl Log {
    pub fn new() -> Log {
        Log {
            id: None,
            current_window_id: None,
            current_program_process_name: None,
            current_program_name: None,
            current_browser_title: None,
            current_mouse_position: None,
            created_at_minutes: None,
            start_time_minutes: None,
            end_time_minutes: None,
            duration_minutes: None,
            keys_pressed_count: None,
            mouse_movement_mm: None,
            left_click_count: None,
            right_click_count: None,
            middle_click_count: None,
            category: None,
            is_idle: false,
        }
    }

    pub fn get_minutes_since_epoch(time: DateTime<Utc>) -> i64 {
        time.timestamp() / 60
    }

    pub fn get_duration_minutes(&self) -> Option<i32> {
        match (self.end_time_minutes, self.start_time_minutes) {
            (Some(end), Some(start)) => Some((end - start) as i32),
            _ => None,
        }
    }
}

use crate::log::Log;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct IdleTracker {
    // amount of time we will wait without any activity
    // before we consider the user idle
    pub idle_threshold_ms: i64,

    pub last_mouse_position: Option<(i32, i32)>,
    pub last_keys_pressed_count: Option<usize>,
}

impl IdleTracker {
    pub fn new() -> Self {
        Self {
            idle_threshold_ms: 4000,
            last_mouse_position: None,
            last_keys_pressed_count: None,
        }
    }

    /*
     * Checks if the user is idle by comparing the current mouse position and key press count
     * to the last values stored in the tracker.
     * If the user is idle, the tracker updates the last values and returns true.
     * Otherwise, it returns false.
     */
    pub fn is_idle(&mut self, log: &Log) -> bool {
        let current_mouse_position = log.current_mouse_position.unwrap_or_default();
        let current_keys_pressed_count = log.keys_pressed_count.unwrap_or_default();

        if let (Some(last_mouse_position), Some(last_keys_pressed_count)) =
            (self.last_mouse_position, self.last_keys_pressed_count)
        {
            if current_mouse_position == last_mouse_position
                && current_keys_pressed_count == last_keys_pressed_count
            {
                return false;
            }
        }

        self.last_mouse_position = Some(current_mouse_position);
        self.last_keys_pressed_count = Some(current_keys_pressed_count);

        return true;
    }
}

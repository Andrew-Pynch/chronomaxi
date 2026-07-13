//! Native macOS capture backend. No per-tick osascript anywhere -- window
//! title/app identity come from the AX tree (ax.rs), cursor position and
//! idle state from CGEventSource/CGEventSourceSecondsSinceLastEventType
//! (zero permission), and key/click counts from a ListenOnly CGEventTap
//! (event_tap.rs, gated by Input Monitoring, independent of Accessibility).

mod ax;
mod event_tap;
mod permissions;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

use crate::capture::ActiveWindow;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

const K_CG_EVENT_SOURCE_STATE_HID_SYSTEM: i32 = 1;
const K_CG_ANY_INPUT_EVENT_TYPE: u32 = u32::MAX;

pub struct MacosCapture {
    source: CGEventSource,
    key_count: Arc<AtomicUsize>,
    left_click_count: Arc<AtomicUsize>,
    right_click_count: Arc<AtomicUsize>,
    middle_click_count: Arc<AtomicUsize>,
    accessibility_granted: bool,
    input_monitoring_granted: bool,
    _tap_handle: Option<event_tap::TapHandle>,
}

impl MacosCapture {
    pub fn new() -> Self {
        let accessibility_granted = permissions::accessibility_trusted_with_prompt();
        if !accessibility_granted {
            println!(
                "CHRONOMAXI WINDOW TITLES UNAVAILABLE: grant Accessibility in System Settings > Privacy & Security > Accessibility for the chronomaxi binary."
            );
        }

        permissions::input_monitoring_request();
        let input_monitoring_granted = permissions::input_monitoring_preflight();
        if !input_monitoring_granted {
            println!(
                "CHRONOMAXI INPUT COUNTS UNAVAILABLE: grant Input Monitoring in System Settings > Privacy & Security > Input Monitoring for the chronomaxi binary."
            );
        }

        let key_count = Arc::new(AtomicUsize::new(0));
        let left_click_count = Arc::new(AtomicUsize::new(0));
        let right_click_count = Arc::new(AtomicUsize::new(0));
        let middle_click_count = Arc::new(AtomicUsize::new(0));

        let tap_handle = if input_monitoring_granted {
            event_tap::install(
                key_count.clone(),
                left_click_count.clone(),
                right_click_count.clone(),
                middle_click_count.clone(),
            )
        } else {
            None
        };

        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
            .expect("failed to create CGEventSource");

        Self {
            source,
            key_count,
            left_click_count,
            right_click_count,
            middle_click_count,
            accessibility_granted,
            input_monitoring_granted,
            _tap_handle: tap_handle,
        }
    }

    pub fn active_window(&self) -> Option<ActiveWindow> {
        ax::focused_window(self.accessibility_granted)
    }

    pub fn mouse_position(&self) -> (i32, i32) {
        CGEvent::new(self.source.clone())
            .map(|event| {
                let point = event.location();
                (point.x as i32, point.y as i32)
            })
            .unwrap_or((0, 0))
    }

    /// Seconds since the last HID input event of any kind -- the same
    /// authoritative, permission-free primitive macOS's own screensaver /
    /// auto-lock uses.
    pub fn idle_seconds(&self) -> f64 {
        unsafe { CGEventSourceSecondsSinceLastEventType(K_CG_EVENT_SOURCE_STATE_HID_SYSTEM, K_CG_ANY_INPUT_EVENT_TYPE) }
    }

    pub fn drain_keys_pressed(&self) -> Option<usize> {
        if !self.input_monitoring_granted {
            return None;
        }
        Some(self.key_count.swap(0, Ordering::Relaxed))
    }

    pub fn drain_clicks(&self) -> (usize, usize, usize) {
        if !self.input_monitoring_granted {
            return (0, 0, 0);
        }
        (
            self.left_click_count.swap(0, Ordering::Relaxed),
            self.right_click_count.swap(0, Ordering::Relaxed),
            self.middle_click_count.swap(0, Ordering::Relaxed),
        )
    }
}

//! Installs a ListenOnly CGEventTap on a dedicated OS thread with its own
//! CFRunLoop (LoggerV4's own loop is a tokio async loop, not a CFRunLoop, so
//! the tap needs a thread of its own to pump). ListenOnly means read-only
//! monitoring -- no PostEvent permission needed -- and costs only Input
//! Monitoring (kTCCServiceListenEvent), never Accessibility.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use core_foundation::runloop::CFRunLoop;
use core_graphics::event::{
    CallbackResult, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
};

/// Keeps the dedicated tap thread alive for the process lifetime; dropping
/// it is never expected to happen before process exit (LoggerV4 owns it for
/// its own lifetime), so no join-on-drop plumbing is needed.
pub struct TapHandle {
    _thread: thread::JoinHandle<()>,
}

pub fn install(
    key_count: Arc<AtomicUsize>,
    left_click_count: Arc<AtomicUsize>,
    right_click_count: Arc<AtomicUsize>,
    middle_click_count: Arc<AtomicUsize>,
) -> Option<TapHandle> {
    let builder = thread::Builder::new().name("chronomaxi-event-tap".to_string());

    let joined = builder
        .spawn(move || {
            let events = vec![
                CGEventType::KeyDown,
                CGEventType::LeftMouseDown,
                CGEventType::RightMouseDown,
                CGEventType::OtherMouseDown,
            ];

            let result = CGEventTap::with_enabled(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                events,
                move |_proxy, event_type, _event| {
                    match event_type {
                        CGEventType::KeyDown => {
                            key_count.fetch_add(1, Ordering::Relaxed);
                        }
                        CGEventType::LeftMouseDown => {
                            left_click_count.fetch_add(1, Ordering::Relaxed);
                        }
                        CGEventType::RightMouseDown => {
                            right_click_count.fetch_add(1, Ordering::Relaxed);
                        }
                        CGEventType::OtherMouseDown => {
                            middle_click_count.fetch_add(1, Ordering::Relaxed);
                        }
                        _ => {}
                    }
                    CallbackResult::Keep
                },
                CFRunLoop::run_current,
            );

            if result.is_err() {
                println!("chronomaxi: failed to install CGEventTap (Input Monitoring not granted?)");
            }
        })
        .ok()?;

    Some(TapHandle { _thread: joined })
}

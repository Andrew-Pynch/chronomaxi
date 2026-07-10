//! Focused-app/window lookup via the Accessibility (AX) API tree. Zero
//! CGWindowListCopyWindowInfo usage -- that path needs Screen Recording
//! permission for kCGWindowName since Catalina, which this design avoids
//! needing entirely.

use accessibility_ng::{AXAttribute, AXUIElement, AXUIElementAttributes};
use cocoa::base::{id, nil};
use core_foundation::base::{CFType, TCFType};
use core_foundation::string::CFString;
use objc::{class, msg_send, sel, sel_impl};

use crate::capture::ActiveWindow;

/// kAXFocusedWindowAttribute has no named accessor in accessibility-ng's
/// generated attribute list (verified against its own source), so it is
/// reached through the crate's `AXAttribute<CFType>::new` escape hatch and
/// downcast from the returned `CFType` to `AXUIElement`.
fn focused_window_attribute() -> AXAttribute<CFType> {
    AXAttribute::<CFType>::new(&CFString::from_static_string("AXFocusedWindow"))
}

/// Reads the focused application + its focused window's title through the
/// AX tree. Returns `None` outright when Accessibility isn't granted so the
/// caller can fall back to `unknown_window()` uniformly with the other
/// backends.
pub fn focused_window(accessibility_granted: bool) -> Option<ActiveWindow> {
    if !accessibility_granted {
        return None;
    }

    let system = AXUIElement::system_wide();
    let focused_app: AXUIElement = system.attribute(&AXAttribute::focused_application()).ok()?;
    let pid = focused_app.pid().ok()?;

    let (program_name, program_process_name) = pid_to_names(pid);

    let window: Option<AXUIElement> = focused_app
        .attribute(&focused_window_attribute())
        .ok()
        .and_then(|value| value.downcast::<AXUIElement>());

    let (id_str, title) = match window {
        Some(window) => {
            let title = window.title().map(|t| t.to_string()).unwrap_or_else(|_| "unknown".to_string());
            // AXUIElementRefs support pointer-identity comparison for the
            // same underlying UI element within a session, which is the
            // only property downstream span-boundary detection relies on.
            let id_str = format!("{:?}", window.as_concrete_TypeRef());
            (id_str, title)
        }
        // No public, stable numeric window-id API exists on macOS; degrade
        // to app-switch granularity when AX has no focused window.
        None => (format!("pid:{}", pid), "unknown".to_string()),
    };

    Some(ActiveWindow {
        id: id_str,
        program_process_name,
        program_name,
        title,
    })
}

/// pid -> (localizedName, lowercased localizedName). Needs no permission.
fn pid_to_names(pid: i32) -> (String, String) {
    unsafe {
        let app: id = msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
        if app == nil {
            return ("unknown".to_string(), "unknown".to_string());
        }

        let name: id = msg_send![app, localizedName];
        if name == nil {
            return ("unknown".to_string(), "unknown".to_string());
        }

        let name_str = nsstring_to_string(name);
        let lower = name_str.to_lowercase();
        (name_str, lower)
    }
}

unsafe fn nsstring_to_string(ns_string: id) -> String {
    let bytes: *const std::os::raw::c_char = msg_send![ns_string, UTF8String];
    if bytes.is_null() {
        return String::new();
    }
    std::ffi::CStr::from_ptr(bytes).to_string_lossy().to_string()
}

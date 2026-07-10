//! Accessibility gates window-title/id reads (kTCCServiceAccessibility);
//! Input Monitoring gates key/click counts (kTCCServiceListenEvent). These
//! are two independent TCC services -- a user can grant one without the
//! other, so every caller here degrades independently rather than assuming
//! one implies the other.

use accessibility_ng::AXUIElement;

/// Shows the native "chronomaxi-tracker would like to control this computer
/// using accessibility features" dialog on first run (no-op if already
/// granted or already prompted). Returns the current trust state.
pub fn accessibility_trusted_with_prompt() -> bool {
    AXUIElement::application_is_trusted_with_prompt()
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn CGRequestListenEventAccess() -> bool;
    fn CGPreflightListenEventAccess() -> bool;
}

/// Triggers the native Input Monitoring permission dialog on first run.
/// Safe to call even when a CGEventTap is never actually installed.
pub fn input_monitoring_request() {
    unsafe {
        CGRequestListenEventAccess();
    }
}

/// Checks current Input Monitoring grant state without prompting.
pub fn input_monitoring_preflight() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

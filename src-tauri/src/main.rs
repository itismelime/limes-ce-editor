// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must be set before WebView2 initializes. This is the only reliable way to
    // prevent the grey flash — put_DefaultBackgroundColor has a race condition per
    // Microsoft's own docs. Format: ARGB hex, alpha first (ff = fully opaque).
    #[cfg(target_os = "windows")]
    unsafe { std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "ff020617"); }

    limes_ce_editor_lib::run()
}

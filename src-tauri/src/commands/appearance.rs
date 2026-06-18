use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
use tauri::{TitleBarStyle, WebviewWindowBuilder};

pub fn apply_vibrancy_to_builder<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    intensity: f64,
) -> WebviewWindowBuilder<'a, R, M> {
    if !cfg!(target_os = "macos") {
        return builder;
    }
    // Always transparent so vibrancy can be toggled at runtime — macOS only
    // allows setting window transparency at creation time.
    let builder = builder.transparent(true);
    if intensity <= 0.0 {
        return builder;
    }
    builder
        .title_bar_style(TitleBarStyle::Overlay)
        .effects(WindowEffectsConfig {
            effects: vec![Effect::UnderWindowBackground],
            state: Some(EffectState::FollowsWindowActiveState),
            ..Default::default()
        })
}

#[tauri::command]
pub fn set_window_vibrancy(window: tauri::Window, intensity: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if intensity <= 0.0 {
            window
                .set_effects(None)
                .map_err(|e| format!("Failed to clear effects: {e}"))?;
            window
                .set_title_bar_style(TitleBarStyle::Visible)
                .map_err(|e| format!("Failed to restore title bar: {e}"))?;
        } else {
            window
                .set_effects(Some(WindowEffectsConfig {
                    effects: vec![Effect::UnderWindowBackground],
                    state: Some(EffectState::FollowsWindowActiveState),
                    ..Default::default()
                }))
                .map_err(|e| format!("Failed to set effects: {e}"))?;
            window
                .set_title_bar_style(TitleBarStyle::Overlay)
                .map_err(|e| format!("Failed to set overlay title bar: {e}"))?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, intensity);
    }
    Ok(())
}

#[tauri::command]
pub fn get_reduce_transparency() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_reduce_transparency()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn macos_reduce_transparency() -> bool {
    use std::process::Command;
    // Read the macOS accessibility preference via defaults.
    // This avoids needing objc2-app-kit feature flags as a direct dependency.
    Command::new("defaults")
        .args(["read", "com.apple.universalaccess", "reduceTransparency"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

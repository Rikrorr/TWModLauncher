use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct GamePathResult {
    pub path: Option<String>,
    pub source: String,
}

/// Validate a user-selected game folder contains the game exe
#[tauri::command]
pub fn validate_game_path(path: String) -> GamePathResult {
    let p = PathBuf::from(&path);
    let exe = p.join("The Scroll of Taiwu.exe");
    if exe.exists() {
        GamePathResult {
            path: Some(path),
            source: "manual".into(),
        }
    } else {
        GamePathResult {
            path: None,
            source: "none".into(),
        }
    }
}

/// Get app data directory for storing profiles / config
#[tauri::command]
pub fn get_app_data_dir() -> String {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TWModLauncher");
    fs::create_dir_all(&dir).ok();
    dir.to_string_lossy().to_string()
}

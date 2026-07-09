use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct GamePathResult {
    pub path: Option<String>,
    pub source: String,
}

/// Validate a user-selected game folder contains the game exe.
/// Returns distinct errors for permission denied, missing path, and not-a-directory
/// so the frontend can show targeted messages.
#[tauri::command]
pub fn validate_game_path(path: String) -> Result<GamePathResult, String> {
    let p = PathBuf::from(&path);

    // Check path accessibility first to distinguish permission / not-found errors
    match fs::metadata(&p) {
        Err(e) => {
            return match e.kind() {
                std::io::ErrorKind::PermissionDenied => Err("PERMISSION_DENIED".into()),
                _ => Err("PATH_NOT_FOUND".into()),
            };
        }
        Ok(meta) => {
            if !meta.is_dir() {
                return Err("NOT_A_DIRECTORY".into());
            }
        }
    }

    let exe = p.join("The Scroll of Taiwu.exe");
    if exe.exists() {
        Ok(GamePathResult {
            path: Some(path),
            source: "manual".into(),
        })
    } else {
        Ok(GamePathResult {
            path: None,
            source: "none".into(),
        })
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

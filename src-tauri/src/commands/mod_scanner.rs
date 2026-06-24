use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct ModScanEntry {
    pub file_id: String,
    pub source: u8, // 1 = Workshop, 0 = Local
    pub dir_path: String,
    pub cover_path: String,
    /// Base64-encoded data URL (e.g. "data:image/jpeg;base64,...") or empty
    pub cover_data: String,
    pub config_raw: String,
    pub settings_raw: String,
    /// ISO 8601 timestamp of the mod directory's last modification
    pub modified_at: String,
}

#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub entries: Vec<ModScanEntry>,
    pub mod_settings_raw: String,
}

fn read_cover_as_data_url(path: &PathBuf) -> String {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return String::new(),
    };
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    )
}

fn scan_dir(dir: &PathBuf, source: u8) -> Vec<ModScanEntry> {
    let mut entries = Vec::new();
    if !dir.exists() {
        return entries;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(d) => d,
        Err(_) => return entries,
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file_id = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let config_raw =
            fs::read_to_string(path.join("Config.lua")).unwrap_or_default();
        let settings_raw =
            fs::read_to_string(path.join("Settings.Lua")).unwrap_or_default();

        let (cover_path, cover_data) = if path.join("Cover.jpg").exists() {
            let p = path.join("Cover.jpg");
            let d = read_cover_as_data_url(&p);
            (p.to_string_lossy().to_string(), d)
        } else if path.join("Cover.png").exists() {
            let p = path.join("Cover.png");
            let d = read_cover_as_data_url(&p);
            (p.to_string_lossy().to_string(), d)
        } else {
            (String::new(), String::new())
        };

        let dir_path = path.to_string_lossy().to_string();

        let modified_at = fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        entries.push(ModScanEntry {
            file_id,
            source,
            dir_path,
            cover_path,
            cover_data,
            config_raw,
            settings_raw,
            modified_at,
        });
    }
    entries
}

/// Scan workshop and local mod directories, reading raw Lua files.
/// Derives workshop / save paths from the game root.
#[tauri::command]
pub fn scan_mods(game_path: String) -> ScanResult {
    let game = PathBuf::from(&game_path);

    // Workshop mods: {steamapps}/workshop/content/838350/
    let steamapps = game
        .parent()
        .and_then(|common| common.parent())
        .map(|sa| sa.join("workshop").join("content").join("838350"));

    // Local mods: {game_path}/Mod/
    let local_dir = game.join("Mod");

    // ModSettings.Lua: {game_path}/SaveGames/ModSettings.Lua
    let mod_settings_path = game.join("SaveGames").join("ModSettings.Lua");

    let mut entries = Vec::new();

    if let Some(ws_dir) = steamapps {
        entries.extend(scan_dir(&ws_dir, 1));
    }
    entries.extend(scan_dir(&local_dir, 0));

    let mod_settings_raw =
        fs::read_to_string(&mod_settings_path).unwrap_or_default();

    ScanResult {
        entries,
        mod_settings_raw,
    }
}

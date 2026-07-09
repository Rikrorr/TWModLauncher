use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io;
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
    /// Non-fatal warnings (permission issues on sub-directories, read failures, etc.)
    pub warnings: Vec<String>,
}

const COVER_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];

fn is_image_ext(ext: &str) -> bool {
    COVER_EXTENSIONS.contains(&ext.to_lowercase().as_str())
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

/// Try to find a cover image in the mod directory.
/// Tier 1: Cover.jpg / Cover.png (conventional names)
/// Tier 2: first file matching any image extension (secondary fallback)
fn find_cover(path: &PathBuf) -> (String, String) {
    // Tier 1: conventional names
    if path.join("Cover.jpg").exists() {
        let p = path.join("Cover.jpg");
        let d = read_cover_as_data_url(&p);
        return (p.to_string_lossy().to_string(), d);
    }
    if path.join("Cover.png").exists() {
        let p = path.join("Cover.png");
        let d = read_cover_as_data_url(&p);
        return (p.to_string_lossy().to_string(), d);
    }

    // Tier 2: first image file found in directory
    if let Ok(rd) = fs::read_dir(path) {
        for entry in rd.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let ext = p
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if is_image_ext(&ext) {
                let d = read_cover_as_data_url(&p);
                return (p.to_string_lossy().to_string(), d);
            }
        }
    }

    (String::new(), String::new())
}

fn scan_dir(dir: &PathBuf, source: u8, warnings: &mut Vec<String>) -> Vec<ModScanEntry> {
    let mut entries = Vec::new();
    if !dir.exists() {
        return entries;
    }
    let read_dir = match fs::read_dir(dir) {
        Ok(d) => d,
        Err(e) => {
            match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    warnings.push(format!(
                        "Mod 目录无读取权限: {}",
                        dir.to_string_lossy()
                    ));
                }
                _ => {
                    // Directory doesn't exist or other I/O error — silently skip
                }
            }
            return entries;
        }
    };

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue, // individual entry I/O error, skip
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file_id = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let config_result = fs::read_to_string(path.join("Config.lua"));
        let config_raw = config_result.unwrap_or_default();
        // If Config.lua read failed and returned empty, note it
        if config_raw.is_empty() && path.join("Config.lua").exists() {
            warnings.push(format!(
                "Config.lua 读取失败: {}/{}",
                if source == 1 { "workshop" } else { "local" },
                file_id,
            ));
        }

        let settings_raw =
            fs::read_to_string(path.join("Settings.Lua")).unwrap_or_default();

        let (cover_path, cover_data) = find_cover(&path);

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
pub fn scan_mods(game_path: String) -> Result<ScanResult, String> {
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
    let mut warnings: Vec<String> = Vec::new();

    if let Some(ws_dir) = steamapps {
        entries.extend(scan_dir(&ws_dir, 1, &mut warnings));
    }
    entries.extend(scan_dir(&local_dir, 0, &mut warnings));

    // If we got zero entries AND there are permission warnings, this is a
    // critical failure — report it so the frontend can show a targeted message.
    if entries.is_empty() && warnings.iter().any(|w| w.contains("无读取权限")) {
        return Err("权限不足，无法读取 Mod 目录".into());
    }

    let mod_settings_raw = fs::read_to_string(&mod_settings_path).unwrap_or_default();
    // ModSettings.Lua missing is normal for first launch; only warn if it
    // exists on disk but couldn't be read (permission / encoding issue).
    if mod_settings_raw.is_empty() && mod_settings_path.exists() {
        warnings.push("ModSettings.Lua 读取失败，启用状态可能不准确".into());
    }

    Ok(ScanResult {
        entries,
        mod_settings_raw,
        warnings,
    })
}

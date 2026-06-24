use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileMeta {
    pub name: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "modCount")]
    pub mod_count: u32,
}

fn profiles_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TWModLauncher")
        .join("profiles");
    fs::create_dir_all(&dir).ok();
    dir
}

fn profile_path(name: &str) -> PathBuf {
    profiles_dir().join(format!("{}.json", name))
}

#[tauri::command]
pub fn list_profiles() -> Result<Vec<ProfileMeta>, String> {
    let dir = profiles_dir();
    let mut profiles = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
        if let Ok(raw) = fs::read_to_string(&path) {
            // Parse JSON and count enabled mods from the enabledMods array
            let mod_count = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v.get("enabledMods").cloned())
                .and_then(|v| v.as_array().map(|a| a.len() as u32))
                .unwrap_or_else(|| {
                    // Fallback for old profiles: count "fileId" occurrences
                    raw.matches("\"fileId\"").count() as u32
                });
            // Parse createdAt from JSON or use empty string
            let created_at = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| v.get("createdAt").cloned())
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let meta = ProfileMeta {
                name,
                created_at,
                mod_count,
            };
            profiles.push(meta);
        }
    }
    Ok(profiles)
}

#[tauri::command]
pub fn save_profile(name: String, data: String) -> Result<(), String> {
    let path = profile_path(&name);
    // Validate that data is valid JSON
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("JSON格式错误: {e}"))?;
    fs::write(&path, &data).map_err(|e| format!("保存失败: {e}"))
}

#[tauri::command]
pub fn load_profile(name: String) -> Result<String, String> {
    let path = profile_path(&name);
    fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
pub fn delete_profile(name: String) -> Result<(), String> {
    let path = profile_path(&name);
    fs::remove_file(&path).map_err(|e| format!("删除失败: {e}"))
}

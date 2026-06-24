use std::fs;
use std::path::PathBuf;

/// Get the path to ModSettings.Lua
fn mod_settings_path(game_path: &str) -> PathBuf {
    PathBuf::from(game_path).join("SaveGames").join("ModSettings.Lua")
}

/// Backup file before modifying
fn backup(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let bak = path.with_extension("Lua.bak");
    fs::copy(path, &bak).map_err(|e| format!("备份失败: {e}"))?;
    Ok(())
}

/// Read a single mod's Settings.Lua file
#[tauri::command]
pub fn read_settings_file(mod_dir: String) -> String {
    let path = PathBuf::from(&mod_dir).join("Settings.Lua");
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write a single mod's Settings.Lua file (with backup)
#[tauri::command]
pub fn write_settings_file(mod_dir: String, raw: String) -> Result<(), String> {
    let path = PathBuf::from(&mod_dir).join("Settings.Lua");
    if path.exists() {
        let bak = path.with_extension("Lua.bak");
        fs::copy(&path, &bak).map_err(|e| format!("备份失败: {e}"))?;
    }
    fs::write(&path, &raw).map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// Read ModSettings.Lua raw content
#[tauri::command]
pub fn read_mod_settings(game_path: String) -> String {
    let path = mod_settings_path(&game_path);
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write raw content to ModSettings.Lua (with backup)
#[tauri::command]
pub fn write_mod_settings(game_path: String, raw: String) -> Result<(), String> {
    let path = mod_settings_path(&game_path);
    backup(&path)?;
    fs::write(&path, &raw).map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

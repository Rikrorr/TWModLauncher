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

/// Write a single mod's Settings.Lua file (with backup, atomic write, and verification)
#[tauri::command]
pub fn write_settings_file(mod_dir: String, raw: String) -> Result<(), String> {
    let path = PathBuf::from(&mod_dir).join("Settings.Lua");
    if path.exists() {
        let bak = path.with_extension("Lua.bak");
        fs::copy(&path, &bak).map_err(|e| format!("备份失败: {e}"))?;
    }
    // Atomic write
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &raw).map_err(|e| format!("写入失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("写入失败: {e}")
    })?;
    // Verify written content
    let written = fs::read_to_string(&path).map_err(|e| format!("验证失败: {e}"))?;
    if written != raw {
        return Err("验证失败: 写入内容与预期不一致".into());
    }
    Ok(())
}

/// Read ModSettings.Lua raw content
#[tauri::command]
pub fn read_mod_settings(game_path: String) -> String {
    let path = mod_settings_path(&game_path);
    fs::read_to_string(&path).unwrap_or_default()
}

/// Write raw content to ModSettings.Lua (with backup, atomic write, and verification)
#[tauri::command]
pub fn write_mod_settings(game_path: String, raw: String) -> Result<(), String> {
    let path = mod_settings_path(&game_path);
    backup(&path)?;
    // Atomic write
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &raw).map_err(|e| format!("写入失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("写入失败: {e}")
    })?;
    // Verify written content
    let written = fs::read_to_string(&path).map_err(|e| format!("验证失败: {e}"))?;
    if written != raw {
        return Err("验证失败: 写入内容与预期不一致".into());
    }
    Ok(())
}

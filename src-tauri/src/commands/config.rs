use std::fs;
use std::path::PathBuf;

fn config_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("TWModLauncher")
        .join("config.json")
}

#[tauri::command]
pub fn load_config() -> String {
    fs::read_to_string(config_path()).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
pub fn save_config(data: String) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    // Validate JSON before saving
    serde_json::from_str::<serde_json::Value>(&data)
        .map_err(|e| format!("JSON格式错误: {e}"))?;
    fs::write(&path, &data).map_err(|e| format!("保存失败: {e}"))
}

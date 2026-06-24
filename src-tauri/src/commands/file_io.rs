use std::fs;
use std::path::Path;

/// Write content to an arbitrary file path (used for profile export).
/// Creates parent directories if needed.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(p, &content).map_err(|e| format!("写入文件失败: {}", e))
}

/// Read content from an arbitrary file path (used for profile import).
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path)).map_err(|e| format!("读取文件失败: {}", e))
}

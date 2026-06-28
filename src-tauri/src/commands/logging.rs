/// Receive a log event from the frontend and route it through the Rust log crate,
/// which will write to the rotating file and console via the tracing subscriber.
#[tauri::command]
pub fn log_event(level: String, target: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: &target, "{}", message),
        "warn" => log::warn!(target: &target, "{}", message),
        "info" => log::info!(target: &target, "{}", message),
        "debug" => log::debug!(target: &target, "{}", message),
        _ => log::trace!(target: &target, "{}", message),
    }
}

/// Open the logs directory in the system file explorer.
#[tauri::command]
pub fn open_log_dir() -> Result<(), String> {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("TWModLauncher");
    let log_dir = data_dir.join("logs");
    if !log_dir.exists() {
        return Err("日志目录尚不存在".to_string());
    }
    std::process::Command::new("cmd")
        .args(["/C", "start", &log_dir.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("打开日志目录失败: {e}"))?;
    Ok(())
}

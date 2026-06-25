use std::path::PathBuf;
use std::process::{Child, Command};

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

pub struct GameProcess(pub Mutex<Option<Child>>);

/// Launch The Scroll of Taiwu.exe from the game directory
#[tauri::command]
pub fn launch_game(
    game_path: String,
    state: tauri::State<GameProcess>,
) -> Result<(), String> {
    let exe = PathBuf::from(&game_path).join("The Scroll of Taiwu.exe");
    if !exe.exists() {
        return Err(format!("未找到游戏程序: {}", exe.display()));
    }

    let child = Command::new(&exe)
        .current_dir(&game_path)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;

    // Brief wait to let the launcher initialize
    thread::sleep(Duration::from_millis(1500));

    // Store the process handle for polling.
    // Note: the game launcher may spawn a child process and exit itself (exit code 53).
    // We don't check exit status here — polling via check_game_running handles that.
    let mut guard = state.0.lock().map_err(|_| "内部状态错误".to_string())?;
    *guard = Some(child);
    Ok(())
}

/// Check if the game process is still running
#[tauri::command]
pub fn check_game_running(state: tauri::State<GameProcess>) -> bool {
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                false
            }
            Ok(None) => true,
            Err(_) => {
                *guard = None;
                false
            }
        }
    } else {
        // No handle stored (e.g. Steam launch) — check by process name
        check_process_running()
    }
}

/// Kill the game process (handle kill + taskkill fallback)
#[tauri::command]
pub fn kill_game(state: tauri::State<GameProcess>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "内部状态错误".to_string())?;
    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        *guard = None;
    }
    // Fallback: kill by process name (handles launcher-detached / Steam-launched game)
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "The Scroll of Taiwu.exe"])
        .output();
    Ok(())
}

/// Launch the game via Steam protocol (steam://rungameid/838350)
#[tauri::command]
pub fn launch_game_steam() -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "steam://rungameid/838350"])
        .spawn()
        .map_err(|e| format!("Steam 启动失败: {e}"))?;
    Ok(())
}

/// Check if game exe is running by process name (no handle needed)
fn check_process_running() -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq The Scroll of Taiwu.exe", "/NH"])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains("The Scroll of Taiwu.exe"),
        Err(_) => false,
    }
}

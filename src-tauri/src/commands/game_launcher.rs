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
        false
    }
}

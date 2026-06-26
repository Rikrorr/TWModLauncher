use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// CREATE_NO_WINDOW flag — suppresses console windows for background subprocesses
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Build a Command for a background console utility (tasklist, powershell, cmd, etc.).
/// On Windows this suppresses the terminal popup via CREATE_NO_WINDOW.
fn bg_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        let _ = cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub struct GameProcess {
    pub child: Mutex<Option<Child>>,
    pub pid: Mutex<Option<u32>>,
}

/// Fuzzy-search for the game process by name and return its PID.
fn find_game_pid() -> Option<u32> {
    let output = bg_cmd("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-Process -Name '*Taiwu*' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().parse::<u32>().ok()
}

/// Verify a PID is still alive via tasklist
fn pid_alive(pid: u32) -> bool {
    match bg_cmd("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()),
        Err(_) => false,
    }
}

/// Spawn a background thread that monitors a PID and emits "game-exited" on exit.
fn start_pid_monitor(app_handle: tauri::AppHandle, pid: u32) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(1500));
        if !pid_alive(pid) {
            let _ = app_handle.emit("game-exited", ());
            break;
        }
    });
}

/// Check if Steam is installed by verifying the steam:// protocol registration
fn steam_installed() -> bool {
    bg_cmd("reg")
        .args(["query", r"HKEY_CLASSES_ROOT\steam\shell\open\command", "/ve"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Spawn a background thread for Steam-launched games.
/// Waits for the game process to appear, then monitors until exit.
fn start_steam_monitor(app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        // Wait for Steam to launch the game (may take several seconds)
        thread::sleep(Duration::from_secs(6));
        // Retry PID discovery for up to ~30s
        for _ in 0..12 {
            if let Some(pid) = find_game_pid() {
                // Found it — monitor until exit
                loop {
                    thread::sleep(Duration::from_millis(1500));
                    if !pid_alive(pid) {
                        let _ = app_handle.emit("game-exited", ());
                        return;
                    }
                }
            }
            thread::sleep(Duration::from_secs(2));
        }
        // Game never started or already exited
        let _ = app_handle.emit("game-exited", ());
    });
}

/// Launch The Scroll of Taiwu.exe from the game directory
#[tauri::command]
pub fn launch_game(
    game_path: String,
    state: tauri::State<GameProcess>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let exe = PathBuf::from(&game_path).join("The Scroll of Taiwu.exe");
    if !exe.exists() {
        return Err(format!("未找到游戏程序: {}", exe.display()));
    }

    let child = Command::new(&exe)
        .current_dir(&game_path)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;

    {
        let mut guard = state.child.lock().map_err(|_| "内部状态错误".to_string())?;
        *guard = Some(child);
    }

    // Wait for the launcher to spawn the real game process, then capture its PID.
    thread::sleep(Duration::from_millis(3000));

    if let Some(pid) = find_game_pid() {
        let mut guard = state.pid.lock().map_err(|_| "内部状态错误".to_string())?;
        *guard = Some(pid);
        start_pid_monitor(app_handle, pid);
    } else {
        // Game failed to start — notify frontend
        let _ = app_handle.emit("game-exited", ());
    }

    Ok(())
}

/// Quick check if the game process is currently running.
/// Used by frontend to detect already-running game on startup.
#[tauri::command]
pub fn check_game_running(state: tauri::State<GameProcess>) -> bool {
    if let Ok(guard) = state.pid.lock() {
        if let Some(pid) = *guard {
            if pid_alive(pid) {
                return true;
            }
        }
    }
    find_game_pid().is_some()
}

/// Kill the game process.
/// Phase 1: graceful WM_CLOSE (allows Steamworks to clean up).
/// Phase 2: forceful process-tree kill as fallback.
#[tauri::command]
pub fn kill_game(state: tauri::State<GameProcess>) -> Result<(), String> {
    let target_pid = state.pid.lock().ok().and_then(|g| *g);

    // Phase 1 — graceful close (WM_CLOSE), gives Steamworks a chance to shut down
    if let Some(pid) = target_pid {
        let _ = bg_cmd("taskkill")
            .args(["/PID", &pid.to_string()])
            .output();
        // Wait for graceful shutdown
        thread::sleep(Duration::from_secs(2));
    }

    // Phase 2 — force-kill the entire process tree
    if let Some(pid) = target_pid {
        if pid_alive(pid) {
            let _ = bg_cmd("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
    }

    // Kill stored child handle
    if let Ok(mut guard) = state.child.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
        }
        *guard = None;
    }

    // Fuzzy kill fallback — process tree by image name
    let _ = bg_cmd("taskkill")
        .args(["/F", "/T", "/IM", "The Scroll of Taiwu.exe"])
        .output();

    // Clear stored PID
    if let Ok(mut guard) = state.pid.lock() {
        *guard = None;
    }

    Ok(())
}

/// Launch the game via Steam protocol (steam://rungameid/838350)
#[tauri::command]
pub fn launch_game_steam(app_handle: tauri::AppHandle) -> Result<(), String> {
    if !steam_installed() {
        return Err("未检测到 Steam 客户端，请确认 Steam 已安装".to_string());
    }

    bg_cmd("cmd")
        .args(["/C", "start", "steam://rungameid/838350"])
        .spawn()
        .map_err(|e| format!("Steam 启动失败: {e}"))?;

    start_steam_monitor(app_handle);
    Ok(())
}

/// Open a Steam Workshop item page in the Steam client
#[tauri::command]
pub fn open_steam_workshop(file_id: String) -> Result<(), String> {
    bg_cmd("cmd")
        .args([
            "/C",
            "start",
            &format!("steam://url/CommunityFilePage/{}", file_id),
        ])
        .spawn()
        .map_err(|e| format!("打开工坊失败: {e}"))?;
    Ok(())
}

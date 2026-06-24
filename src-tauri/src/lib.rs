mod commands;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::game_launcher::GameProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::game_path::validate_game_path,
            commands::game_path::get_app_data_dir,
            commands::mod_scanner::scan_mods,
            commands::mod_settings::read_mod_settings,
            commands::mod_settings::write_mod_settings,
            commands::mod_settings::read_settings_file,
            commands::mod_settings::write_settings_file,
            commands::game_launcher::launch_game,
            commands::game_launcher::check_game_running,
            commands::profiles::list_profiles,
            commands::profiles::save_profile,
            commands::profiles::load_profile,
            commands::profiles::delete_profile,
            commands::file_io::write_file,
            commands::file_io::read_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

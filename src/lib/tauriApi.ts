import { invoke } from "@tauri-apps/api/core";
import type { GamePathResult, ScanResult, ProfileMeta } from "./types";

/** Validate a manually-selected game folder */
export async function validateGamePath(
  path: string,
): Promise<GamePathResult> {
  return invoke<GamePathResult>("validate_game_path", { path });
}

/** Get the app data directory for profile storage */
export async function getAppDataDir(): Promise<string> {
  return invoke<string>("get_app_data_dir");
}

/** Scan workshop + local mod directories, returning raw Lua text */
export async function scanMods(
  gamePath: string,
): Promise<ScanResult> {
  return invoke<ScanResult>("scan_mods", { gamePath });
}

/** Write complete ModSettings.Lua content (with backup) */
export async function writeModSettings(
  gamePath: string,
  raw: string,
): Promise<void> {
  return invoke("write_mod_settings", { gamePath, raw });
}

/** Read a single mod's Settings.Lua file */
export async function readSettingsFile(
  modDir: string,
): Promise<string> {
  return invoke<string>("read_settings_file", { modDir });
}

/** Write a single mod's Settings.Lua file */
export async function writeSettingsFile(
  modDir: string,
  raw: string,
): Promise<void> {
  return invoke("write_settings_file", { modDir, raw });
}

/** Launch the game executable */
export async function launchGame(
  gamePath: string,
): Promise<void> {
  return invoke("launch_game", { gamePath });
}

/** Check if the game process is still running */
export async function checkGameRunning(): Promise<boolean> {
  return invoke<boolean>("check_game_running");
}

/** Kill the game process */
export async function killGame(): Promise<void> {
  return invoke("kill_game");
}

/** Launch the game via Steam protocol */
export async function launchGameSteam(): Promise<void> {
  return invoke("launch_game_steam");
}

/** List saved profile names */
export async function listProfiles(): Promise<ProfileMeta[]> {
  return invoke<ProfileMeta[]>("list_profiles");
}

/** Save a profile JSON to app data dir */
export async function saveProfile(
  name: string,
  data: string,
): Promise<void> {
  return invoke("save_profile", { name, data });
}

/** Load a profile JSON from app data dir */
export async function loadProfile(name: string): Promise<string> {
  return invoke<string>("load_profile", { name });
}

/** Delete a profile JSON */
export async function deleteProfile(name: string): Promise<void> {
  return invoke("delete_profile", { name });
}

/** Write content to an arbitrary file path (for export) */
export async function writeFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke("write_file", { path, content });
}

/** Read content from an arbitrary file path (for import) */
export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

/** Load persistent config JSON from app data dir */
export async function loadConfig(): Promise<string> {
  return invoke<string>("load_config");
}

/** Save persistent config JSON to app data dir */
export async function saveConfig(data: string): Promise<void> {
  return invoke("save_config", { data });
}

/** Open a folder in the system file explorer */
export async function openInExplorer(path: string): Promise<void> {
  return invoke("open_in_explorer", { path });
}

/** Open a Steam Workshop item page in the Steam client */
export async function openSteamWorkshop(fileId: number): Promise<void> {
  return invoke("open_steam_workshop", { fileId: fileId.toString() });
}

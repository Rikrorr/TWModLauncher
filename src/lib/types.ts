/** Result from game path detection commands */
export interface GamePathResult {
  path: string | null;
  source: "auto" | "manual" | "none";
}

/** Raw entry returned by Rust scan_mods command */
export interface ModScanEntry {
  file_id: string;
  source: number; // 1 = Workshop, 0 = Local
  dir_path: string;
  cover_path: string;
  cover_data: string; // Base64 data URL or empty
  config_raw: string;
  settings_raw: string;
}

/** Result from scan_mods Rust command */
export interface ScanResult {
  entries: ModScanEntry[];
  mod_settings_raw: string;
}

/** Mod metadata parsed from Config.lua */
export interface ModInfo {
  fileId: number;
  title: string;
  author: string;
  version: string;
  gameVersion: string;
  description: string;
  source: number; // 1 = Workshop, 0 = Local
  dirPath: string;
  coverPath?: string;
  coverData?: string; // Base64 data URL
  settingGroups: string[];
  defaultSettings: ModSettingDef[];
  currentSettings: Record<string, unknown>;
  enabled: boolean;
  installed: boolean;
  order: number;
  tagList: string[];
  needRestart: boolean;
  parseError: boolean;
  /** True if Config.lua is missing or empty (residual workshop folder / empty local mod) */
  isResidual: boolean;
}

/** A single setting definition from Config.lua DefaultSettings */
export interface ModSettingDef {
  settingType: "Toggle" | "Slider" | "Dropdown";
  key: string;
  displayName: string;
  description: string;
  groupName: string;
  defaultValue: unknown;
  minValue?: number;
  maxValue?: number;
  stepSize?: number;
  options?: Record<number, string>;
}

/** Profile metadata for saved mod configurations */
export interface ProfileMeta {
  name: string;
  createdAt: string;
  modCount: number;
}

/** Full profile data saved to disk */
export interface ProfileData {
  name: string;
  createdAt: string;
  gamePath: string;
  enabledMods: string[];
  modOrder: Record<string, number>;
  modSettings: Record<string, Record<string, unknown>>;
}

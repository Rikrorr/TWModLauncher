import { useCallback } from "react";
import { scanMods } from "../lib/tauriApi";
import {
  parseConfigLua,
  parseModSettingsLua,
  parseSettingsLua,
  type ParsedModSettings,
} from "../lib/luaParser";
import { useModStore } from "../store/useModStore";
import { useAppStore } from "../store/useAppStore";
import type { ModInfo } from "../lib/types";
import { resolveTagName } from "../utils/tagMapping";

/** Simple string hash to generate unique numeric IDs from non-numeric directory names */
function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

/** Parse scan result into ModInfo list */
function parseScanResult(
  result: { entries: { file_id: string; source: number; dir_path: string; cover_path: string; cover_data: string; config_raw: string; settings_raw: string }[]; mod_settings_raw: string },
  ms: ParsedModSettings,
): ModInfo[] {
  const mods: ModInfo[] = [];
  for (const entry of result.entries) {
    try {
      const config = parseConfigLua(entry.config_raw);
      const currentSettings = parseSettingsLua(entry.settings_raw);
      const fid = entry.file_id;
      const fileId = Number(fid) || hashStr(fid);
      const prefixedId = `${entry.source}_${fid}`;
      const enabled =
        entry.source === 1
          ? ms.enabledWorkshopMods.includes(prefixedId)
          : ms.enabledLocalMods.includes(prefixedId);
      const isResidual = config.parseError || !entry.config_raw.trim();

      mods.push({
        fileId,
        title: config.title || `Mod #${entry.file_id}`,
        author: config.author,
        version: config.version,
        gameVersion: config.gameVersion,
        description: config.description,
        source: entry.source,
        dirPath: entry.dir_path,
        coverPath: entry.cover_path || undefined,
        coverData: entry.cover_data || undefined,
        settingGroups: [
          ...new Set(config.defaultSettings.map((s) => s.groupName).filter(Boolean)),
        ],
        defaultSettings: config.defaultSettings,
        currentSettings,
        enabled,
        installed: true,
        order: ms.modOrder[prefixedId] ?? 0,
        tagList: config.tags.map(resolveTagName),
        needRestart: config.needRestart,
        parseError: config.parseError,
        isResidual,
      });
    } catch (e) {
      console.error(`[scanMods] Failed to parse entry ${entry.file_id}:`, e);
      mods.push({
        fileId: Number(entry.file_id) || hashStr(entry.file_id),
        title: `Mod #${entry.file_id} (解析失败)`,
        author: "",
        version: "",
        gameVersion: "",
        description: "",
        source: entry.source,
        dirPath: entry.dir_path,
        coverPath: entry.cover_path || undefined,
        coverData: entry.cover_data || undefined,
        settingGroups: [],
        defaultSettings: [],
        currentSettings: {},
        enabled: false,
        installed: true,
        order: 0,
        tagList: [],
        needRestart: false,
        parseError: true,
        isResidual: true,
      });
    }
  }
  return mods;
}

export function useModScanner() {
  const setMods = useModStore((s) => s.setMods);
  const setScanning = useModStore((s) => s.setScanning);
  const setError = useModStore((s) => s.setError);
  const setTemplateRaw = useAppStore((s) => s.setTemplateRaw);

  const scan = useCallback(
    async (gamePath: string) => {
      setScanning(true);
      setError(null);
      try {
        const result = await scanMods(gamePath);
        console.log(
          "[scanMods] got",
          result.entries.length,
          "entries, modSettings raw length:",
          result.mod_settings_raw.length,
        );

        let ms = parseModSettingsSafe(result.mod_settings_raw);
        const mods = parseScanResult(result, ms);

        setMods(mods);
        setTemplateRaw(result.mod_settings_raw);
      } catch (e) {
        console.error("[scanMods] Fatal:", e);
        setError(`扫描失败: ${String(e)}`);
      } finally {
        setScanning(false);
      }
    },
    [setMods, setScanning, setError],
  );

  /** Re-scan directories and merge changes into the existing list.
   *  Returns counts of added and removed mods. */
  const rescan = useCallback(
    async (gamePath: string): Promise<{ added: number; removed: number }> => {
      setScanning(true);
      try {
        const result = await scanMods(gamePath);
        let ms = parseModSettingsSafe(result.mod_settings_raw);
        const freshMods = parseScanResult(result, ms);

        // Update templateRaw so future saves use latest ModSettings.Lua
        setTemplateRaw(result.mod_settings_raw);

        const existing = useModStore.getState().mods;
        const existingKeys = new Set(
          existing.map((m) => `${m.source}_${m.fileId}`),
        );
        const freshKeys = new Set(
          freshMods.map((m) => `${m.source}_${m.fileId}`),
        );

        // New mods: in fresh but not in existing
        const added = freshMods.filter(
          (m) => !existingKeys.has(`${m.source}_${m.fileId}`),
        );

        // Removed mods: in existing but not in fresh
        const removed = [...existingKeys].filter((k) => !freshKeys.has(k));

        if (added.length > 0 || removed.length > 0) {
          // Merge: keep existing state for mods still present, drop removed, add new
          const merged = existing
            .filter((m) => freshKeys.has(`${m.source}_${m.fileId}`))
            .map((m) => {
              const key = `${m.source}_${m.fileId}`;
              const fresh = freshMods.find(
                (f) => `${f.source}_${f.fileId}` === key,
              );
              if (fresh) {
                return { ...m, enabled: fresh.enabled, order: fresh.order };
              }
              return m;
            });
          merged.push(...added);
          setMods(merged);
        }

        return { added: added.length, removed: removed.length };
      } catch (e) {
        console.error("[rescanMods] Fatal:", e);
        return { added: 0, removed: 0 };
      } finally {
        setScanning(false);
      }
    },
    [setMods, setScanning],
  );

  return { scan, rescan };
}

function parseModSettingsSafe(raw: string): ParsedModSettings {
  try {
    return parseModSettingsLua(raw);
  } catch (e) {
    console.error("[scanMods] ModSettings parse failed:", e);
    return { enabledWorkshopMods: [], enabledLocalMods: [], modOrder: {} };
  }
}

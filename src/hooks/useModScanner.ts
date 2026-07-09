import { createLogger } from "../lib/logger";
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
import type { ModInfo, ScanMeta } from "../lib/types";
import { resolveTagName } from "../utils/tagMapping";

/** Format Unix timestamp (seconds) to readable date */
function formatDate(secs: string): string {
  const n = Number(secs);
  if (!n) return "";
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Simple string hash to generate unique numeric IDs from non-numeric directory names */
function hashStr(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

/** Parse scan result into ModInfo list, counting failed entries */
function parseScanResult(
  result: { entries: { file_id: string; source: number; dir_path: string; cover_path: string; cover_data: string; config_raw: string; settings_raw: string; modified_at: string }[]; mod_settings_raw: string; warnings: string[] },
  ms: ParsedModSettings,
): { mods: ModInfo[]; failedCount: number; failedModNames: string[] } {
  const mods: ModInfo[] = [];
  let failedCount = 0;
  const failedModNames: string[] = [];
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

      if (config.parseError) {
        failedCount++;
        failedModNames.push(config.title || entry.file_id);
      }

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
        updatedAt: formatDate(entry.modified_at),
      });
    } catch (e) {
      log.error(`Failed to parse entry ${entry.file_id}: ${String(e)}`);
      failedCount++;
      failedModNames.push(entry.file_id);
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
        updatedAt: formatDate(entry.modified_at),
      });
    }
  }
  return { mods, failedCount, failedModNames };
}

const log = createLogger("useModScanner");

export function useModScanner() {
  const setMods = useModStore((s) => s.setMods);
  const setScanning = useModStore((s) => s.setScanning);
  const setError = useModStore((s) => s.setError);
  const setTemplateRaw = useAppStore((s) => s.setTemplateRaw);

  const scan = useCallback(
    async (gamePath: string): Promise<ScanMeta | null> => {
      setScanning(true);
      setError(null);
      try {
        const result = await scanMods(gamePath);
        log.debug(`got ${result.entries.length} entries, modSettings raw length: ${result.mod_settings_raw.length}`);

        const msParsed = parseModSettingsSafe(result.mod_settings_raw);
        const { mods, failedCount, failedModNames } = parseScanResult(result, msParsed.result);

        setMods(mods);
        setTemplateRaw(result.mod_settings_raw);

        return {
          total: mods.length,
          enabled: mods.filter((m) => m.enabled).length,
          failedCount,
          msParseFailed: msParsed.failed,
          warnings: result.warnings,
          failedModNames,
        };
      } catch (e) {
        log.error(`Fatal: ${String(e)}`);
        setError(`扫描失败: ${String(e)}`);
        return null;
      } finally {
        setScanning(false);
      }
    },
    [setMods, setScanning, setError],
  );

  /** Re-scan directories and merge changes into the existing list.
   *  Returns counts of added and removed mods plus metadata. */
  const rescan = useCallback(
    async (gamePath: string): Promise<{ added: number; removed: number; failedCount: number; msParseFailed: boolean; warnings: string[]; failedModNames: string[] } | null> => {
      setScanning(true);
      try {
        const result = await scanMods(gamePath);
        const msParsed = parseModSettingsSafe(result.mod_settings_raw);
        const { mods: freshMods, failedCount, failedModNames } = parseScanResult(result, msParsed.result);

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

        return {
          added: added.length,
          removed: removed.length,
          failedCount,
          msParseFailed: msParsed.failed,
          warnings: result.warnings,
          failedModNames,
        };
      } catch (e) {
        log.error(`Fatal rescan: ${String(e)}`);
        return null;
      } finally {
        setScanning(false);
      }
    },
    [setMods, setScanning],
  );

  return { scan, rescan };
}

function parseModSettingsSafe(raw: string): { result: ParsedModSettings; failed: boolean } {
  try {
    return { result: parseModSettingsLua(raw), failed: false };
  } catch (e) {
    log.error(`ModSettings parse failed: ${String(e)}`);
    return { result: { enabledWorkshopMods: [], enabledLocalMods: [], modOrder: {} }, failed: true };
  }
}

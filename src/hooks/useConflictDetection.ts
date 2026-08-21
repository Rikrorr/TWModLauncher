import { useMemo } from "react";
import type { ModInfo } from "../lib/types";

export interface ConflictGroup {
  type: "dll" | "settingKey";
  name: string;
  modKeys: string[];
  /** dll = high confidence (same DLL file = duplicate install), settingKey = suspected */
  severity: "high" | "suspected";
}

/**
 * Conflict detection for enabled mods:
 *  1. DLL duplicate — two mods list the same file in BackendPlugins (high confidence)
 *  2. Setting Key duplicate — two mods define the same DefaultSettings key (suspected)
 * Only enabled mods are considered (per active scheme / global state).
 */
export function useConflictDetection(mods: ModInfo[]): {
  conflicts: ConflictGroup[];
  conflictMap: Map<string, ConflictGroup[]>;
} {
  return useMemo(() => {
    const enabled = mods.filter((m) => m.enabled && !m.isResidual);

    const conflicts: ConflictGroup[] = [];
    const conflictMap = new Map<string, ConflictGroup[]>();
    const addConflict = (group: ConflictGroup) => {
      conflicts.push(group);
      for (const k of group.modKeys) {
        const arr = conflictMap.get(k) ?? [];
        arr.push(group);
        conflictMap.set(k, arr);
      }
    };

    // 1. DLL duplicates (high confidence)
    const dllIndex = new Map<string, string[]>();
    for (const m of enabled) {
      for (const dll of m.backendPlugins ?? []) {
        const name = dll.trim();
        if (!name) continue;
        const list = dllIndex.get(name) ?? [];
        list.push(`${m.source}_${m.fileId}`);
        dllIndex.set(name, list);
      }
    }
    for (const [dll, keys] of dllIndex) {
      const unique = [...new Set(keys)];
      if (unique.length > 1) {
        addConflict({
          type: "dll",
          name: dll,
          modKeys: unique,
          severity: "high",
        });
      }
    }

    // 2. Setting Key duplicates (suspected)
    const keyIndex = new Map<string, string[]>();
    for (const m of enabled) {
      for (const s of m.defaultSettings ?? []) {
        if (!s.key) continue;
        const list = keyIndex.get(s.key) ?? [];
        list.push(`${m.source}_${m.fileId}`);
        keyIndex.set(s.key, list);
      }
    }
    for (const [key, keys] of keyIndex) {
      const unique = [...new Set(keys)];
      if (unique.length > 1) {
        addConflict({
          type: "settingKey",
          name: key,
          modKeys: unique,
          severity: "suspected",
        });
      }
    }

    return { conflicts, conflictMap };
  }, [mods]);
}

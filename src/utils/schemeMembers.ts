import type { ModCollection, ModInfo, ProfileData, ProfileDataV1 } from "../lib/types";
import { loadProfile, saveProfile } from "../lib/tauriApi";
import { isProfileV2, migrateProfileV1 } from "./migrateProfile";

/** Load a profile (with v1→v2 migration) as ProfileData. */
export async function loadScheme(name: string): Promise<ProfileData | null> {
  try {
    const raw = await loadProfile(name);
    const parsed = JSON.parse(raw) as ProfileData | ProfileDataV1;
    return isProfileV2(parsed) ? (parsed as ProfileData) : migrateProfileV1(parsed);
  } catch {
    return null;
  }
}

/** Add mod keys to a scheme's member whitelist + enabled list (dedup).
 *  Optionally carries a per-mod settings snapshot (from the read-mods base config).
 *  Also appends new members to displayOrder so drag-to-reorder works. */
export function addModsToScheme(
  data: ProfileData,
  modKeys: string[],
  modMeta: ProfileData["modMeta"],
  modSettings?: Record<string, Record<string, unknown>>,
): ProfileData {
  const memberSet = new Set(data.modKeys ?? []);
  const enabledSet = new Set(data.enabledMods ?? []);
  const displayOrder = [...(data.displayOrder ?? [])];
  const loadOrder = [...(data.loadOrder ?? [])];
  for (const k of modKeys) {
    const isNew = !memberSet.has(k);
    memberSet.add(k);
    enabledSet.add(k); // newly added mods are enabled by default
    // Append new members to the unified displayOrder (group ids preserved)
    if (isNew && !displayOrder.includes(k)) displayOrder.push(k);
    // Append new members to the load order as well
    if (isNew && !loadOrder.includes(k)) loadOrder.push(k);
  }
  return {
    ...data,
    modKeys: [...memberSet],
    enabledMods: [...enabledSet],
    displayOrder,
    loadOrder,
    modMeta: { ...(data.modMeta ?? {}), ...modMeta },
    modSettings: modSettings
      ? { ...(data.modSettings ?? {}), ...modSettings }
      : data.modSettings,
  };
}

/** Build a per-mod settings snapshot map from the read-mods (disk) current settings. */
export function buildModSettings(
  mods: ModInfo[],
  keys: string[],
): Record<string, Record<string, unknown>> {
  const settings: Record<string, Record<string, unknown>> = {};
  for (const m of mods) {
    const key = `${m.source}_${m.fileId}`;
    if (!keys.includes(key)) continue;
    if (m.currentSettings && Object.keys(m.currentSettings).length > 0) {
      settings[key] = { ...m.currentSettings };
    }
  }
  return settings;
}

/** Remove mod keys from a scheme (member + enabled + order + settings + groups). */
export function removeModsFromScheme(data: ProfileData, modKeys: string[]): ProfileData {
  const rm = new Set(modKeys);
  const modOrder = { ...(data.modOrder ?? {}) };
  const modSettings = { ...(data.modSettings ?? {}) };
  for (const k of rm) {
    delete modOrder[k];
    delete modSettings[k];
  }
  const groups = (data.groups ?? []).map((g) => ({
    ...g,
    modKeys: g.modKeys.filter((mk) => !rm.has(mk)),
  }));
  return {
    ...data,
    modKeys: (data.modKeys ?? []).filter((k) => !rm.has(k)),
    enabledMods: (data.enabledMods ?? []).filter((k) => !rm.has(k)),
    loadOrder: (data.loadOrder ?? []).filter((k) => !rm.has(k)),
    modOrder,
    modSettings,
    groups,
  };
}

/** Build modMeta map for a set of mods (for adding to schemes/collections). */
export function buildModMeta(mods: ModInfo[], keys: string[]): ProfileData["modMeta"] {
  const meta: ProfileData["modMeta"] = {};
  for (const m of mods) {
    const key = `${m.source}_${m.fileId}`;
    if (!keys.includes(key)) continue;
    meta[key] = {
      title: m.title,
      author: m.author,
      source: m.source,
      fileId: m.fileId,
      ...(m.version ? { version: m.version } : {}),
    };
  }
  return meta;
}

/** Persist a scheme back to disk. */
export async function saveScheme(data: ProfileData): Promise<void> {
  await saveProfile(data.name, JSON.stringify(data, null, 2));
}

/** Strip Windows-invalid filename characters — scheme names become profile
 *  file names on disk (`{name}.json`), so they must survive a filesystem path. */
export function sanitizeSchemeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

/** Default container name with a dotted date (e.g. "方案 2026.9.1") —
 *  the slash-separated locale date would break scheme file names. */
export function dateDefaultName(prefix: string): string {
  const d = new Date();
  return `${prefix} ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

/** Stable-partition a load order by enabled state: enabled mods first (relative
 *  order preserved), disabled mods last (relative order preserved). Used when a
 *  mod is toggled — a disabled mod drops to the end, enabled mods shift up. */
export function reorderDisabledToEnd(
  loadOrder: string[],
  enabledMods: string[],
): string[] {
  const enabled = new Set(enabledMods);
  return [
    ...loadOrder.filter((k) => enabled.has(k)),
    ...loadOrder.filter((k) => !enabled.has(k)),
  ];
}

// ── ★ v2.1: independent load order ──────────────────────────────────────────

/**
 * Effective member load sequence for a scheme. Legacy schemes (no loadOrder)
 * migrate on first use: existing loadOrder filtered to members, then missing
 * members appended sorted by modOrder values, then displayOrder order.
 */
export function ensureLoadOrder(
  scheme: Pick<ProfileData, "modKeys"> & {
    loadOrder?: string[];
    modOrder?: Record<string, number>;
    displayOrder?: string[];
  },
): string[] {
  const members = scheme.modKeys ?? [];
  const existing = (scheme.loadOrder ?? []).filter((k) => members.includes(k));
  const missing = members.filter((k) => !existing.includes(k));
  if (missing.length === 0) return existing;
  const orderMap = scheme.modOrder ?? {};
  const remaining = [...missing].sort((a, b) => {
    const oa = orderMap[a];
    const ob = orderMap[b];
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    const da = (scheme.displayOrder ?? []).indexOf(a);
    const db = (scheme.displayOrder ?? []).indexOf(b);
    if (da !== -1 && db !== -1) return da - db;
    if (da !== -1) return -1;
    if (db !== -1) return 1;
    return 0;
  });
  return [...existing, ...remaining];
}

/**
 * Dense 1..N order map over ALL read mod keys: scheme members follow their load
 * sequence first, remaining keys after by base order. Mirrors the game's own
 * renumbering so the relative load order survives.
 */
export function buildLoadOrderMap(
  allModKeys: string[],
  scheme: Pick<ProfileData, "modKeys" | "loadOrder"> | null,
): Map<string, number> {
  const seq = scheme ? ensureLoadOrder(scheme) : allModKeys;
  const full = [...seq, ...allModKeys.filter((k) => !seq.includes(k))];
  return new Map(full.map((k, i) => [k, i + 1]));
}

// ── Merge collection into scheme (with conflict analysis) ─────────────────

export interface CollectionMergeConflict {
  /** Collection mod keys already present in the scheme. */
  duplicateModKeys: string[];
  /** Collection group names that collide with existing scheme group names. */
  duplicateGroupNames: string[];
}

/** Analyze what would conflict when merging a collection into a scheme. */
export function analyzeCollectionMerge(
  scheme: ProfileData,
  collection: ModCollection,
): CollectionMergeConflict {
  const memberSet = new Set(scheme.modKeys ?? []);
  const duplicateModKeys = collection.modKeys.filter((k) => memberSet.has(k));

  const schemeGroupNames = new Set((scheme.groups ?? []).map((g) => g.name));
  const duplicateGroupNames = (collection.groups ?? [])
    .map((g) => g.name)
    .filter((n) => schemeGroupNames.has(n));

  return { duplicateModKeys, duplicateGroupNames };
}

/**
 * Merge a collection into a scheme.
 * @param mode "all" — apply everything (dedup mods, force-merge groups);
 *             "partial" — skip conflicts (duplicate mods + colliding groups), apply the rest.
 */
export function mergeCollectionIntoScheme(
  scheme: ProfileData,
  collection: ModCollection,
  conflict: CollectionMergeConflict,
  mode: "all" | "partial",
): ProfileData {
  const skipMods = new Set(
    mode === "partial" ? conflict.duplicateModKeys : [],
  );
  const skipGroups = new Set(
    mode === "partial" ? conflict.duplicateGroupNames : [],
  );

  // 1. Merge mod members (enabled by default, dedup)
  const memberSet = new Set(scheme.modKeys ?? []);
  const enabledSet = new Set(scheme.enabledMods ?? []);
  for (const k of collection.modKeys) {
    if (skipMods.has(k)) continue;
    memberSet.add(k);
    enabledSet.add(k);
  }

  // 2. Merge groups: new groups appended with unique ids; mods assigned accordingly
  const existingGroups = scheme.groups ?? [];
  const newGroups = existingGroups.map((g) => ({ ...g }));
  for (const g of collection.groups ?? []) {
    if (skipGroups.has(g.name)) {
      // Partial mode: still merge the group's mods into the scheme (ungrouped) unless duplicated
      for (const mk of g.modKeys) {
        if (!skipMods.has(mk)) {
          memberSet.add(mk);
          enabledSet.add(mk);
        }
      }
      continue;
    }
    const gid = `col-${crypto.randomUUID()}`;
    // ensure each member is in memberSet + enabled
    for (const mk of g.modKeys) {
      if (!skipMods.has(mk)) memberSet.add(mk);
    }
    for (const mk of g.modKeys) {
      if (!skipMods.has(mk)) enabledSet.add(mk);
    }
    newGroups.push({
      id: gid,
      name: g.name,
      collapsed: false,
      modKeys: g.modKeys.filter((mk) => !skipMods.has(mk)),
    });
  }

  // 3. Ungrouped collection mods (not in any collection group)
  const groupedMods = new Set(
    (collection.groups ?? []).flatMap((g) => g.modKeys),
  );
  for (const k of collection.modKeys) {
    if (skipMods.has(k)) continue;
    if (!groupedMods.has(k)) {
      memberSet.add(k);
      enabledSet.add(k);
    }
  }

  // 4. Merge per-mod settings snapshot (skip conflict mods in partial mode)
  const mergedSettings = { ...(scheme.modSettings ?? {}) };
  for (const [k, v] of Object.entries(collection.modSettings ?? {})) {
    if (skipMods.has(k)) continue;
    mergedSettings[k] = v;
  }

  // 5. Build unified displayOrder: keep existing entries (group ids + member keys),
  //    then append new groups and ungrouped members not already present.
  const mergedDisplayOrder = [...(scheme.displayOrder ?? [])];
  for (const g of newGroups) {
    if (!mergedDisplayOrder.includes(g.id)) mergedDisplayOrder.push(g.id);
  }
  for (const mk of [...memberSet]) {
    if (!mergedDisplayOrder.includes(mk)) mergedDisplayOrder.push(mk);
  }

  // 6. ★ v2.1: load order — keep existing member sequence, append newly added members
  const mergedLoadOrder = [...(scheme.loadOrder ?? [])];
  for (const mk of [...memberSet]) {
    if (!mergedLoadOrder.includes(mk)) mergedLoadOrder.push(mk);
  }

  return {
    ...scheme,
    modKeys: [...memberSet],
    enabledMods: [...enabledSet],
    displayOrder: mergedDisplayOrder,
    loadOrder: mergedLoadOrder,
    modMeta: { ...(scheme.modMeta ?? {}), ...(collection.modMeta ?? {}) },
    modSettings: mergedSettings,
    groups: newGroups,
  };
}

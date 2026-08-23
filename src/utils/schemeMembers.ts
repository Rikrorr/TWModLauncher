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

/** Add mod keys to a scheme's member whitelist + enabled list (dedup). */
export function addModsToScheme(
  data: ProfileData,
  modKeys: string[],
  modMeta: ProfileData["modMeta"],
): ProfileData {
  const memberSet = new Set(data.modKeys ?? []);
  const enabledSet = new Set(data.enabledMods ?? []);
  for (const k of modKeys) {
    memberSet.add(k);
    enabledSet.add(k); // newly added mods are enabled by default
  }
  return {
    ...data,
    modKeys: [...memberSet],
    enabledMods: [...enabledSet],
    modMeta: { ...(data.modMeta ?? {}), ...modMeta },
  };
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

  return {
    ...scheme,
    modKeys: [...memberSet],
    enabledMods: [...enabledSet],
    modMeta: { ...(scheme.modMeta ?? {}), ...(collection.modMeta ?? {}) },
    groups: newGroups,
  };
}

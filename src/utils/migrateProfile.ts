import type { ModInfo, ModMeta, ModGroup, ProfileData, ProfileDataV1 } from "../lib/types";

/**
 * Migrate a legacy v1 profile to v2.
 * v2 adds: modKeys (member whitelist) + optional modCategories/modNotes.
 * modKeys is derived as the union of every referenced mod key.
 * Categories/notes are not present in v1 — they fall back to global stores.
 */
export function migrateProfileV1(raw: ProfileDataV1): ProfileData {
  const groups: ModGroup[] = raw.groups ?? [];
  const modKeys = [
    ...new Set([
      ...(raw.enabledMods ?? []),
      ...Object.keys(raw.modOrder ?? {}),
      ...Object.keys(raw.modSettings ?? {}),
      ...groups.flatMap((g) => g.modKeys ?? []),
    ]),
  ];
  return {
    version: 2,
    name: raw.name,
    createdAt: raw.createdAt,
    gamePath: raw.gamePath,
    modKeys,
    enabledMods: raw.enabledMods ?? [],
    modOrder: raw.modOrder ?? {},
    modSettings: raw.modSettings ?? {},
    groups,
    displayOrder: raw.displayOrder ?? [],
    groupOrder: raw.groupOrder,
    modMeta: raw.modMeta ?? {},
    // v1 has no per-scheme categories/notes — global stores take over
  };
}

/** True if the given profile is already v2 (or later). */
export function isProfileV2(data: ProfileData | ProfileDataV1): data is ProfileData {
  return (data.version ?? 1) >= 2;
}

/**
 * Compare a profile/collection's referenced mod keys against the currently
 * installed mods. Returns a Map of missing mod keys -> ModMeta
 * (only for mods that have metadata).
 * Shared by profile loading and collection import.
 */
export function detectMissingMods(
  data: {
    enabledMods: string[];
    modOrder?: Record<string, number>;
    modSettings?: Record<string, Record<string, unknown>>;
    groups?: { modKeys: string[] }[];
    modKeys?: string[];
    modMeta?: Record<string, ModMeta>;
  },
  mods: ModInfo[],
): Map<string, ModMeta> {
  const installedKeys = new Set(mods.map((m) => `${m.source}_${m.fileId}`));
  const referencedKeys = new Set<string>();
  (data.modKeys ?? []).forEach((k) => referencedKeys.add(k));
  (data.enabledMods ?? []).forEach((k) => referencedKeys.add(k));
  Object.keys(data.modOrder ?? {}).forEach((k) => referencedKeys.add(k));
  Object.keys(data.modSettings ?? {}).forEach((k) => referencedKeys.add(k));
  (data.groups ?? []).forEach((g) => g.modKeys.forEach((k) => referencedKeys.add(k)));

  const missing = new Map<string, ModMeta>();
  for (const key of referencedKeys) {
    if (!installedKeys.has(key) && data.modMeta?.[key]) {
      missing.set(key, data.modMeta[key]);
    }
  }
  return missing;
}

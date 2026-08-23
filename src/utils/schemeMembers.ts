import type { ModInfo, ProfileData, ProfileDataV1 } from "../lib/types";
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

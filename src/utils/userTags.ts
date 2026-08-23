import type { ModInfo } from "../lib/types";
import { useCategoryStore } from "../store/useCategoryStore";

/**
 * v3: user tags are stored as "categories" (modCats maps modKey → category ids).
 * This unifies the official Config.lua tagList with user-defined tags so both
 * participate in the same tag filter and appear together on the mod card.
 */

/** Resolve a mod's user-defined tag names (official tag semantics). */
export function getUserTags(mod: Pick<ModInfo, "source" | "fileId">): string[] {
  const key = `${mod.source}_${mod.fileId}`;
  const state = useCategoryStore.getState();
  const ids = state.modCats[key] ?? [];
  if (ids.length === 0) return [];
  const idToName = new Map(state.categories.map((c) => [c.id, c.name]));
  return ids.map((id) => idToName.get(id) ?? "").filter(Boolean);
}

/** All user tag names across the store (for the tag filter dropdown). */
export function getAllUserTags(): string[] {
  const state = useCategoryStore.getState();
  const names = new Set<string>();
  for (const c of state.categories) names.add(c.name);
  return [...names].sort((a, b) => a.localeCompare(b, "zh"));
}

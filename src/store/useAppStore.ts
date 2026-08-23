import { create } from "zustand";
import type { ModGroup } from "../lib/types";

function loadInitialGroups(): ModGroup[] {
  try {
    const raw = localStorage.getItem("twm-filter-prefs");
    if (raw) {
      const prefs = JSON.parse(raw);
      const rawGroups: ModGroup[] = prefs.groups ?? [];
      // Deduplicate within each group.
      const dedupedGroups: ModGroup[] = rawGroups.map((g) => ({
        ...g,
        modKeys: [...new Set(g.modKeys)],
      }));
      // Cross-deduplicate across groups: if a modKey appears in multiple
      // groups, keep it only in the first group encountered.
      const seenKeys = new Set<string>();
      const crossGroups: ModGroup[] = dedupedGroups.map((g) => {
        const cleaned = g.modKeys.filter((mk) => {
          if (seenKeys.has(mk)) return false;
          seenKeys.add(mk);
          return true;
        });
        return cleaned.length === g.modKeys.length ? g : { ...g, modKeys: cleaned };
      });
      return crossGroups;
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

const initialGroups = loadInitialGroups();

// ★ v3: persist edit selections across sub-page switches within a session
function loadEditSelections(): { schemeEditName: string | null; collectionEditId: string | null } {
  try {
    const raw = localStorage.getItem("twm-edit-selections");
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        schemeEditName: typeof parsed.schemeEditName === "string" ? parsed.schemeEditName : null,
        collectionEditId: typeof parsed.collectionEditId === "string" ? parsed.collectionEditId : null,
      };
    }
  } catch { /* ignore */ }
  return { schemeEditName: null, collectionEditId: null };
}

function persistEditSelections(schemeEditName: string | null, collectionEditId: string | null): void {
  try {
    localStorage.setItem("twm-edit-selections", JSON.stringify({ schemeEditName, collectionEditId }));
  } catch { /* ignore */ }
}

const initialEdits = loadEditSelections();

interface AppState {
  /** Detected game installation path */
  gamePath: string | null;
  /** How the game path was determined */
  pathSource: "auto" | "manual" | "none";
  /** True while auto-detection is in progress */
  detecting: boolean;
  /** Error message to display, if any */
  error: string | null;
  /** Last notification message (persistent) */
  lastMessage: string | null;
  /** Raw ModSettings.Lua content used as template for patching */
  templateRaw: string;
  /** Virtual mod groups (order is determined by displayOrder) */
  groups: ModGroup[];
  /** True when in-memory mod state differs from what's on disk */
  isDirty: boolean;
  /** Mod keys with unsaved per-mod Settings.Lua changes */
  dirtyModSettings: string[];
  /** ★ v2: Name of the currently active scheme (null = none active) */
  activeSchemeName: string | null;
  /** ★ v2: Member modKeys of the active scheme (null = no scheme active) */
  activeSchemeModKeys: string[] | null;
  /** ★ v3: Scheme currently being edited on the Schemes page (persisted) */
  schemeEditName: string | null;
  /** ★ v3: Collection currently being edited on the Collections page (persisted) */
  collectionEditId: string | null;

  setGamePath: (path: string, source: "auto" | "manual") => void;
  setDetecting: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setLastMessage: (msg: string | null) => void;
  setTemplateRaw: (raw: string) => void;
  setGroups: (groups: ModGroup[] | ((prev: ModGroup[]) => ModGroup[])) => void;
  clearPath: () => void;
  setDirty: (v: boolean) => void;
  addDirtyModSetting: (key: string) => void;
  clearDirtyModSettings: () => void;
  removeDirtyModSettings: (keys: string[]) => void;
  /** ★ v2: Set the active scheme name */
  setActiveSchemeName: (name: string | null) => void;
  /** ★ v2: Set the active scheme member modKeys */
  setActiveSchemeModKeys: (keys: string[] | null) => void;
  /** ★ v3: Set the scheme being edited (persisted) */
  setSchemeEditName: (name: string | null) => void;
  /** ★ v3: Set the collection being edited (persisted) */
  setCollectionEditId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  gamePath: null,
  pathSource: "none",
  detecting: false,
  error: null,
  lastMessage: null,
  templateRaw: "",
  groups: initialGroups,
  isDirty: false,
  dirtyModSettings: [],
  activeSchemeName: null,
  activeSchemeModKeys: null,
  schemeEditName: initialEdits.schemeEditName,
  collectionEditId: initialEdits.collectionEditId,

  setGamePath: (path, source) =>
    set({ gamePath: path, pathSource: source, error: null }),
  setDetecting: (v) => set({ detecting: v }),
  setError: (msg) => set({ error: msg }),
  setLastMessage: (msg) => set({ lastMessage: msg }),
  setTemplateRaw: (raw) => set({ templateRaw: raw }),
  setGroups: (groups) => set((state) => ({ groups: typeof groups === "function" ? groups(state.groups) : groups })),
  clearPath: () =>
    set({ gamePath: null, pathSource: "none", error: null, dirtyModSettings: [], activeSchemeName: null, activeSchemeModKeys: null }),
  setDirty: (v) => set({ isDirty: v }),
  addDirtyModSetting: (key) =>
    set((s) => ({
      dirtyModSettings: s.dirtyModSettings.includes(key)
        ? s.dirtyModSettings
        : [...s.dirtyModSettings, key],
    })),
  clearDirtyModSettings: () => set({ dirtyModSettings: [] }),
  removeDirtyModSettings: (keys) =>
    set((s) => ({
      dirtyModSettings: s.dirtyModSettings.filter((k) => !keys.includes(k)),
    })),
  setActiveSchemeName: (name) => set({ activeSchemeName: name }),
  setActiveSchemeModKeys: (keys) => set({ activeSchemeModKeys: keys }),
  setSchemeEditName: (name) => {
    set({ schemeEditName: name });
    const cur = useAppStore.getState();
    persistEditSelections(name, cur.collectionEditId);
  },
  setCollectionEditId: (id) => {
    set({ collectionEditId: id });
    const cur = useAppStore.getState();
    persistEditSelections(cur.schemeEditName, id);
  },
}));

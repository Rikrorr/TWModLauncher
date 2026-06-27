import { create } from "zustand";
import type { ModGroup } from "../lib/types";

function loadInitialGroups(): { groups: ModGroup[]; groupOrder: string[] } {
  try {
    const raw = localStorage.getItem("twm-filter-prefs");
    if (raw) {
      const prefs = JSON.parse(raw);
      const groups: ModGroup[] = prefs.groups ?? [];
      const groupOrder: string[] = prefs.groupOrder ?? groups.map((g) => g.id);
      return { groups, groupOrder };
    }
  } catch {
    // Ignore parse errors
  }
  return { groups: [], groupOrder: [] };
}

const initialGroups = loadInitialGroups();

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
  /** Virtual mod groups */
  groups: ModGroup[];
  /** Visual order of group IDs */
  groupOrder: string[];

  setGamePath: (path: string, source: "auto" | "manual") => void;
  setDetecting: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setLastMessage: (msg: string | null) => void;
  setTemplateRaw: (raw: string) => void;
  setGroups: (groups: ModGroup[] | ((prev: ModGroup[]) => ModGroup[])) => void;
  setGroupOrder: (order: string[] | ((prev: string[]) => string[])) => void;
  clearPath: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  gamePath: null,
  pathSource: "none",
  detecting: false,
  error: null,
  lastMessage: null,
  templateRaw: "",
  groups: initialGroups.groups,
  groupOrder: initialGroups.groupOrder,

  setGamePath: (path, source) =>
    set({ gamePath: path, pathSource: source, error: null }),
  setDetecting: (v) => set({ detecting: v }),
  setError: (msg) => set({ error: msg }),
  setLastMessage: (msg) => set({ lastMessage: msg }),
  setTemplateRaw: (raw) => set({ templateRaw: raw }),
  setGroups: (groups) => set((state) => ({ groups: typeof groups === "function" ? groups(state.groups) : groups })),
  setGroupOrder: (groupOrder) => set((state) => ({ groupOrder: typeof groupOrder === "function" ? groupOrder(state.groupOrder) : groupOrder })),
  clearPath: () =>
    set({ gamePath: null, pathSource: "none", error: null }),
}));

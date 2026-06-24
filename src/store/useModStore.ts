import { create } from "zustand";
import type { ModInfo } from "../lib/types";

interface ModState {
  /** All scanned mods after parsing */
  mods: ModInfo[];
  /** True while scan + parse is in progress */
  scanning: boolean;
  /** Error message if scan fails */
  error: string | null;
  /** Currently selected mod for settings editing (source_fileId) */
  selectedModKey: string | null;

  setMods: (mods: ModInfo[]) => void;
  setScanning: (v: boolean) => void;
  setError: (msg: string | null) => void;
  toggleMod: (fileId: number, enabled: boolean) => void;
  updateModSettings: (key: string, settings: Record<string, unknown>) => void;
  /** Directly set a mod's load order */
  setModOrder: (key: string, order: number) => void;
  clearMods: () => void;
  selectMod: (key: string | null) => void;
}

export const useModStore = create<ModState>((set) => ({
  mods: [],
  scanning: false,
  error: null,
  selectedModKey: null,

  setMods: (mods) => set({ mods, error: null }),
  setScanning: (v) => set({ scanning: v }),
  setError: (msg) => set({ error: msg }),
  toggleMod: (fileId: number, enabled: boolean) =>
    set((s) => ({
      mods: s.mods.map((m) =>
        m.fileId === fileId ? { ...m, enabled } : m
      ),
    })),
  updateModSettings: (key, settings) =>
    set((s) => ({
      mods: s.mods.map((m) =>
        `${m.source}_${m.fileId}` === key
          ? { ...m, currentSettings: settings }
          : m
      ),
    })),
  setModOrder: (key, order) =>
    set((s) => ({
      mods: s.mods.map((m) =>
        `${m.source}_${m.fileId}` === key
          ? { ...m, order: Math.max(0, Math.floor(order)) }
          : m
      ),
    })),
  clearMods: () => set({ mods: [], error: null, selectedModKey: null }),
  selectMod: (key) => set({ selectedModKey: key }),
}));

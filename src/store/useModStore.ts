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

  // ── Multi-select state ──
  /** Multi-selected mod keys */
  selectedModKeys: string[];
  /** Anchor key for Shift range selection */
  lastClickedKey: string | null;

  setMods: (mods: ModInfo[]) => void;
  setScanning: (v: boolean) => void;
  setError: (msg: string | null) => void;
  toggleMod: (fileId: number, enabled: boolean) => void;
  updateModSettings: (key: string, settings: Record<string, unknown>) => void;
  /** Directly set a mod's load order */
  setModOrder: (key: string, order: number) => void;
  clearMods: () => void;
  selectMod: (key: string | null) => void;

  // ── Multi-select actions ──
  /** Clear selection and select a single mod */
  selectModOnly: (key: string) => void;
  /** Toggle a mod in/out of selection */
  toggleSelectMod: (key: string) => void;
  /** Add mod keys to selection (for Shift range select) */
  addModsToSelection: (keys: string[]) => void;
  /** Clear all selection state */
  clearSelection: () => void;
}

export const useModStore = create<ModState>((set) => ({
  mods: [],
  scanning: false,
  error: null,
  selectedModKey: null,

  // ── Multi-select initial state ──
  selectedModKeys: [],
  lastClickedKey: null,

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

  // ── Multi-select actions ──
  selectModOnly: (key) =>
    set({
      selectedModKeys: [key],
      lastClickedKey: key,
    }),
  toggleSelectMod: (key) =>
    set((s) => {
      const exists = s.selectedModKeys.includes(key);
      return {
        selectedModKeys: exists
          ? s.selectedModKeys.filter((k) => k !== key)
          : [...s.selectedModKeys, key],
        lastClickedKey: key,
      };
    }),
  addModsToSelection: (keys) =>
    set((s) => {
      const existing = new Set(s.selectedModKeys);
      for (const k of keys) existing.add(k);
      return {
        selectedModKeys: [...existing],
        lastClickedKey: keys.length > 0 ? keys[keys.length - 1] : s.lastClickedKey,
      };
    }),
  clearSelection: () =>
    set({
      selectedModKeys: [],
      lastClickedKey: null,
    }),
}));

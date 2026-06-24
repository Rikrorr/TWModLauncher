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
  /** Swap order value with adjacent mod (direction: -1 up, +1 down) */
  reorderMods: (key: string, direction: -1 | 1) => void;
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
  reorderMods: (key, direction) =>
    set((s) => {
      // Sort by current order, using natural position as tiebreaker
      const sorted = s.mods
        .map((m, idx) => ({ m, idx }))
        .sort((a, b) => (a.m.order || 999) - (b.m.order || 999) || a.idx - b.idx);
      const pos = sorted.findIndex(
        (x) => `${x.m.source}_${x.m.fileId}` === key,
      );
      if (pos === -1) return s;
      const targetPos = pos + direction;
      if (targetPos < 0 || targetPos >= sorted.length) return s;

      // Swap order values between the two mods
      const modA = sorted[pos].m;
      const modB = sorted[targetPos].m;
      const orderA = modA.order || (pos + 1);
      const orderB = modB.order || (targetPos + 1);

      const keyA = `${modA.source}_${modA.fileId}`;
      const keyB = `${modB.source}_${modB.fileId}`;

      return {
        mods: s.mods.map((m) => {
          const mk = `${m.source}_${m.fileId}`;
          if (mk === keyA) return { ...m, order: orderB };
          if (mk === keyB) return { ...m, order: orderA };
          return m;
        }),
      };
    }),
  clearMods: () => set({ mods: [], error: null, selectedModKey: null }),
  selectMod: (key) => set({ selectedModKey: key }),
}));

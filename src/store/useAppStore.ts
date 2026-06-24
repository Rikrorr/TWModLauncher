import { create } from "zustand";

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

  setGamePath: (path: string, source: "auto" | "manual") => void;
  setDetecting: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setLastMessage: (msg: string | null) => void;
  setTemplateRaw: (raw: string) => void;
  clearPath: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  gamePath: null,
  pathSource: "none",
  detecting: false,
  error: null,
  lastMessage: null,
  templateRaw: "",

  setGamePath: (path, source) =>
    set({ gamePath: path, pathSource: source, error: null }),
  setDetecting: (v) => set({ detecting: v }),
  setError: (msg) => set({ error: msg }),
  setLastMessage: (msg) => set({ lastMessage: msg }),
  setTemplateRaw: (raw) => set({ templateRaw: raw }),
  clearPath: () =>
    set({ gamePath: null, pathSource: "none", error: null }),
}));

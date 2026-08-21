import { create } from "zustand";

const STORAGE_KEY = "twm-mod-notes";

interface NoteState {
  /** modKey → user note text */
  notes: Record<string, string>;
  setNote: (modKey: string, text: string) => void;
  clearNote: (modKey: string) => void;
  hydrate: () => void;
}

function load(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, string>;
  } catch {
    return null;
  }
}

export const useNoteStore = create<NoteState>((set) => ({
  notes: {},

  setNote: (modKey, text) =>
    set((s) => ({ notes: { ...s.notes, [modKey]: text } })),

  clearNote: (modKey) =>
    set((s) => {
      const notes = { ...s.notes };
      delete notes[modKey];
      return { notes };
    }),

  hydrate: () => {
    const loaded = load();
    if (loaded) set({ notes: loaded });
  },
}));

/** Persist note store to localStorage (call after any mutation). */
export function persistNotes(state: NoteState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes));
  } catch {
    // storage unavailable — ignore
  }
}

import { create } from "zustand";

/** User-defined category dictionary (global, cross-scheme) */
export interface CategoryDef {
  id: string;
  name: string;
  color?: string;
}

const STORAGE_KEY = "twm-mod-categories";

interface CategoryState {
  /** User-maintained category dictionary */
  categories: CategoryDef[];
  /** modKey → category id list */
  modCats: Record<string, string[]>;
  addCategory: (name: string, color?: string) => string;
  renameCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
  setModCategories: (modKey: string, catIds: string[]) => void;
  hydrate: () => void;
}

function load(): { categories: CategoryDef[]; modCats: Record<string, string[]> } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.categories)) return null;
    return {
      categories: parsed.categories,
      modCats: typeof parsed.modCats === "object" && parsed.modCats !== null ? parsed.modCats : {},
    };
  } catch {
    return null;
  }
}

const CAT_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  modCats: {},

  addCategory: (name, color) => {
    const id = crypto.randomUUID();
    const nextColor =
      color ?? CAT_COLORS[get().categories.length % CAT_COLORS.length];
    set((s) => ({ categories: [...s.categories, { id, name: name.trim() || "未命名分类", color: nextColor }] }));
    return id;
  },

  renameCategory: (id, name) =>
    set((s) => ({
      categories: s.categories.map((c) =>
        c.id === id ? { ...c, name: name.trim() || c.name } : c,
      ),
    })),

  deleteCategory: (id) =>
    set((s) => {
      const modCats: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(s.modCats)) {
        const filtered = v.filter((cid) => cid !== id);
        if (filtered.length > 0) modCats[k] = filtered;
      }
      return { categories: s.categories.filter((c) => c.id !== id), modCats };
    }),

  setModCategories: (modKey, catIds) =>
    set((s) => ({ modCats: { ...s.modCats, [modKey]: catIds } })),

  hydrate: () => {
    const loaded = load();
    if (loaded) {
      set({ categories: loaded.categories, modCats: loaded.modCats });
    }
  },
}));

/** Persist category store to localStorage (call after any mutation). */
export function persistCategories(state: CategoryState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ categories: state.categories, modCats: state.modCats }),
    );
  } catch {
    // storage unavailable — ignore
  }
}

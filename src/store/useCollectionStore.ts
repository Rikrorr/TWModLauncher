import { create } from "zustand";
import type { ModCollection, ModMeta } from "../lib/types";

const STORAGE_KEY = "twm-mod-collections";

interface CollectionState {
  collections: ModCollection[];
  create: (c: {
    name: string;
    description?: string;
    modKeys: string[];
    groups?: { name: string; modKeys: string[] }[];
    enabledMods?: string[];
    modOrder?: Record<string, number>;
    modSettings?: Record<string, Record<string, unknown>>;
    modMeta: Record<string, ModMeta>;
  }) => ModCollection;
  /** ★ v3: add mod keys (+ optional settings/order snapshot) to an existing collection (dedup). */
  addModsToCollection: (
    id: string,
    modKeys: string[],
    modMeta: Record<string, ModMeta>,
    modSettings?: Record<string, Record<string, unknown>>,
    modOrder?: Record<string, number>,
  ) => boolean;
  remove: (id: string) => void;
  /** Import a collection JSON string. Returns { ok } or { ok:false, error }. */
  importJson: (
    raw: string,
  ) => { ok: boolean; error?: string; collection?: ModCollection };
  /** Export a collection to JSON string. Returns null if id unknown. */
  exportJson: (id: string) => string | null;
  hydrate: () => void;
}

function load(): ModCollection[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as ModCollection[];
  } catch {
    return null;
  }
}

function persist(state: CollectionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collections));
  } catch {
    // storage unavailable — ignore
  }
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],

  create: (c) => {
    const now = new Date().toISOString();
    const col: ModCollection = {
      id: crypto.randomUUID(),
      name: c.name.trim() || "未命名集合",
      description: c.description,
      createdAt: now,
      updatedAt: now,
      modKeys: [...new Set(c.modKeys)],
      groups: c.groups,
      enabledMods: c.enabledMods,
      modOrder: c.modOrder,
      modSettings: c.modSettings,
      modMeta: c.modMeta,
      version: 1,
    };
    set((s) => ({ collections: [col, ...s.collections] }));
    persist(get());
    return col;
  },

  remove: (id) => {
    set((s) => ({ collections: s.collections.filter((c) => c.id !== id) }));
    persist(get());
  },

  addModsToCollection: (id, modKeys, modMeta, modSettings, modOrder) => {
    let changed = false;
    set((s) => ({
      collections: s.collections.map((c) => {
        if (c.id !== id) return c;
        const next = [...new Set([...c.modKeys, ...modKeys])];
        const nextMeta = { ...c.modMeta, ...modMeta };
        const nextSettings = modSettings
          ? { ...(c.modSettings ?? {}), ...modSettings }
          : c.modSettings;
        const nextOrder = modOrder
          ? { ...(c.modOrder ?? {}), ...modOrder }
          : c.modOrder;
        if (
          next.length === c.modKeys.length &&
          Object.keys(nextMeta).length === Object.keys(c.modMeta).length &&
          Object.keys(nextSettings ?? {}).length === Object.keys(c.modSettings ?? {}).length &&
          Object.keys(nextOrder ?? {}).length === Object.keys(c.modOrder ?? {}).length
        ) {
          return c;
        }
        changed = true;
        return {
          ...c,
          modKeys: next,
          modMeta: nextMeta,
          modSettings: nextSettings,
          modOrder: nextOrder,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    persist(get());
    return changed;
  },

  importJson: (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "文件格式无效，请确认选择的是 JSON 集合文件" };
    }
    const col = parsed as Partial<ModCollection>;
    if (
      typeof col !== "object" || col === null ||
      typeof col.name !== "string" ||
      !Array.isArray(col.modKeys)
    ) {
      return { ok: false, error: "无效的集合文件（缺少 name 或 modKeys）" };
    }
    if (col.version !== undefined && col.version > 1) {
      return {
        ok: false,
        error: `集合版本不兼容（文件版本 ${col.version}，当前支持版本 1）`,
      };
    }
    const now = new Date().toISOString();
    const normalized: ModCollection = {
      id: crypto.randomUUID(),
      name: col.name,
      description: col.description,
      createdAt: col.createdAt ?? now,
      updatedAt: now,
      modKeys: [...new Set(col.modKeys)],
      groups: col.groups,
      enabledMods: col.enabledMods,
      modOrder: col.modOrder,
      modSettings: col.modSettings,
      modMeta: col.modMeta ?? {},
      version: 1,
    };
    set((s) => ({ collections: [normalized, ...s.collections] }));
    persist(get());
    return { ok: true, collection: normalized };
  },

  exportJson: (id) => {
    const col = get().collections.find((c) => c.id === id);
    return col ? JSON.stringify(col, null, 2) : null;
  },

  hydrate: () => {
    const loaded = load();
    if (loaded) set({ collections: loaded });
  },
}));

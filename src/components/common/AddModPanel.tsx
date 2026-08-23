import { useMemo, useState } from "react";
import type { ModInfo } from "../../lib/types";
import { useCategoryStore } from "../../store/useCategoryStore";

interface Props {
  /** All read mods (pool) */
  mods: ModInfo[];
  /** Target member keys (already in the container) — disabled in the list */
  existingKeys: Set<string>;
  /** Container label (e.g. 方案 B / 集合 C) */
  targetLabel: string;
  onAdd: (modKeys: string[]) => void;
  onClose: () => void;
}

/**
 * Add-mods panel — full pool with filtering (search / enabled / source / tags / categories).
 * Used by SchemesPage and CollectionsPage "＋ 添加 Mod".
 */
export default function AddModPanel({ mods, existingKeys, targetLabel, onAdd, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<"all" | "workshop" | "local">("all");
  const [activeCatIds, setActiveCatIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const categories = useCategoryStore((s) => s.categories);

  const filtered = useMemo(() => {
    let result = mods;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
    }
    if (enabledOnly) result = result.filter((m) => m.enabled);
    if (sourceFilter === "workshop") result = result.filter((m) => m.source === 1);
    if (sourceFilter === "local") result = result.filter((m) => m.source === 0);
    if (activeCatIds.size > 0) {
      const catState = useCategoryStore.getState();
      result = result.filter((m) => {
        const key = `${m.source}_${m.fileId}`;
        const cats = new Set(catState.modCats[key] ?? []);
        return [...activeCatIds].every((cid) => cats.has(cid));
      });
    }
    return result;
  }, [mods, search, enabledOnly, sourceFilter, activeCatIds]);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleCat = (catId: string) => {
    setActiveCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[720px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200">添加 Mod 到「{targetLabel}」</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-2.5 border-b border-slate-700 flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称/作者/描述..."
            className="flex-1 min-w-40 text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setEnabledOnly((v) => !v)}
            className={`text-xs px-2 py-1.5 rounded border cursor-pointer ${
              enabledOnly ? "border-green-600 bg-green-900/40 text-green-300" : "border-slate-600 text-slate-400"
            }`}
          >
            仅启用
          </button>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
            className="text-xs px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-300 outline-none"
          >
            <option value="all">全部来源</option>
            <option value="workshop">工坊</option>
            <option value="local">本地</option>
          </select>
          {categories.length > 0 && (
            <div className="relative">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) toggleCat(e.target.value);
                }}
                className="text-xs px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-300 outline-none"
              >
                <option value="">自定义分类…</option>
                {categories
                  .filter((c) => !activeCatIds.has(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>
          )}
          {activeCatIds.size > 0 && (
            <div className="flex items-center gap-1">
              {[...activeCatIds].map((cid) => {
                const cat = categories.find((c) => c.id === cid);
                return (
                  <button
                    key={cid}
                    onClick={() => toggleCat(cid)}
                    className="text-[10px] px-2 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-700 cursor-pointer"
                  >
                    {cat?.name ?? cid} ×
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pool list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">无匹配 Mod</p>
          ) : (
            filtered.map((m) => {
              const key = `${m.source}_${m.fileId}`;
              const inExisting = existingKeys.has(key);
              const checked = selected.has(key);
              return (
                <label
                  key={key}
                  className={`flex items-center gap-3 px-3 py-2 rounded border transition-colors cursor-pointer ${
                    inExisting
                      ? "border-slate-800 bg-slate-900/40 opacity-40 cursor-not-allowed"
                      : checked
                        ? "border-blue-600 bg-blue-950/30"
                        : "border-slate-700 hover:border-slate-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={inExisting ? true : checked}
                    disabled={inExisting}
                    onChange={() => toggleSelect(key)}
                    className="accent-blue-500"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs text-slate-200 truncate">{m.title}</span>
                    <span className="block text-[10px] text-slate-500 truncate">{m.author}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0">
                    {m.source === 1 ? "工坊" : "本地"}
                  </span>
                  {inExisting && (
                    <span className="text-[10px] text-slate-600 shrink-0">已在其中</span>
                  )}
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700">
          <span className="text-xs text-slate-500">
            已选 {selected.size} 个
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={() => {
                onAdd([...selected]);
                onClose();
              }}
              disabled={selected.size === 0}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
            >
              加入选中 ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

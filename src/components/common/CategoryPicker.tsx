import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

/** Category picker popup — check/uncheck categories for one mod, or manage the dictionary. */
export default function CategoryPicker({ modKey, title, onClose }: Props) {
  const categories = useCategoryStore((s) => s.categories);
  const modCats = useCategoryStore((s) => s.modCats);
  const setModCategories = useCategoryStore((s) => s.setModCategories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const renameCategory = useCategoryStore((s) => s.renameCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);

  const [newName, setNewName] = useState("");
  const [manageMode, setManageMode] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = useMemo(() => modCats[modKey] ?? [], [modCats, modKey]);

  const toggleCat = useCallback(
    (catId: string) => {
      const next = current.includes(catId)
        ? current.filter((id) => id !== catId)
        : [...current, catId];
      setModCategories(modKey, next);
      persistCategories(useCategoryStore.getState());
    },
    [current, modKey, setModCategories],
  );

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    const id = addCategory(name);
    // Auto-select the new category for this mod
    setModCategories(modKey, [...current, id]);
    persistCategories(useCategoryStore.getState());
    setNewName("");
  };

  // Close on outside click / Escape
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-64 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3"
      style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-200 truncate pr-2" title={title}>
          分类: {title}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setManageMode((v) => !v)}
            className="text-[10px] px-1.5 py-0.5 border border-slate-600 text-slate-400
                       hover:text-slate-200 rounded cursor-pointer"
          >
            {manageMode ? "完成" : "管理"}
          </button>
          <button
            onClick={onClose}
            className="text-[10px] px-1.5 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </div>

      {/* New category input */}
      <div className="flex gap-1 mb-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="新建分类名..."
          className="flex-1 text-xs px-2 py-1 bg-slate-700 border border-slate-600 rounded
                     text-slate-200 outline-none focus:border-blue-500"
        />
        <button
          onClick={handleAdd}
          className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
        >
          +
        </button>
      </div>

      {/* Category list */}
      <div className="max-h-48 overflow-y-auto space-y-1">
        {categories.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">暂无分类，先在上方新建</p>
        ) : (
          categories.map((c) => {
            const checked = current.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-700/50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCat(c.id)}
                  className="sr-only peer"
                />
                <span
                  className={`w-3 h-3 rounded-full border ${
                    checked ? "bg-current" : "border-slate-500"
                  }`}
                  style={{ color: c.color ?? "#3b82f6" }}
                />
                <span className={`text-xs flex-1 ${checked ? "text-slate-200" : "text-slate-400"}`}>
                  {c.name}
                </span>
                {manageMode && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      const next = window.prompt("新分类名:", c.name);
                      if (next && next.trim()) {
                        renameCategory(c.id, next.trim());
                        persistCategories(useCategoryStore.getState());
                      }
                    }}
                    className="text-[10px] text-slate-500 hover:text-slate-200 cursor-pointer"
                  >
                    改名
                  </button>
                )}
                {manageMode && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      deleteCategory(c.id);
                      persistCategories(useCategoryStore.getState());
                    }}
                    className="text-[10px] text-red-500 hover:text-red-400 cursor-pointer"
                  >
                    删
                  </button>
                )}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

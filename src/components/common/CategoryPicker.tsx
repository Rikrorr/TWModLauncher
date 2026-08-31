import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

/**
 * Tag manager window — plan C: mirrors the AddModPanel interaction.
 * Top search box filters the tag list; each row = checkbox (select for this mod)
 * + color dot + name + inline actions (recolor / rename / delete);
 * bottom has an explicit "+ 新建标签" button (small dialog: name + color picker).
 */
export default function CategoryPicker({ modKey, title, onClose }: Props) {
  const categories = useCategoryStore((s) => s.categories);
  const modCats = useCategoryStore((s) => s.modCats);
  const setModCategories = useCategoryStore((s) => s.setModCategories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const renameCategory = useCategoryStore((s) => s.renameCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);

  const current = useMemo(() => modCats[modKey] ?? [], [modCats, modKey]);

  const [search, setSearch] = useState("");
  // Create dialog state (explicit, not hidden in a combobox)
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#3b82f6");
  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Filtered tag list by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  const toggleTag = useCallback(
    (catId: string) => {
      const next = current.includes(catId)
        ? current.filter((id) => id !== catId)
        : [...current, catId];
      setModCategories(modKey, next);
      persistCategories(useCategoryStore.getState());
    },
    [current, modKey, setModCategories],
  );

  const openCreate = () => {
    setCreateName("");
    setCreateColor("#3b82f6");
    setCreateOpen(true);
  };

  const confirmCreate = () => {
    const name = createName.trim();
    if (!name) return;
    addCategory(name, createColor);
    persistCategories(useCategoryStore.getState());
    setCreateOpen(false);
  };

  const openRename = (catId: string, catName: string) => {
    setRenameTarget({ id: catId, name: catName });
    setRenameValue(catName);
  };

  const confirmRename = () => {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (next && next !== renameTarget.name) {
      renameCategory(renameTarget.id, next);
      persistCategories(useCategoryStore.getState());
    }
    setRenameTarget(null);
  };

  const setTagColor = (catId: string, color: string) => {
    const state = useCategoryStore.getState();
    useCategoryStore.setState({
      categories: state.categories.map((cat) =>
        cat.id === catId ? { ...cat, color } : cat,
      ),
    });
    persistCategories(useCategoryStore.getState());
  };

  const removeTag = (catId: string) => {
    deleteCategory(catId);
    persistCategories(useCategoryStore.getState());
  };

  // Click outside panel closes; Escape closes
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
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

  // Dialogs close on outside click / Escape
  useEffect(() => {
    if (!createOpen && !renameTarget) return;
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setCreateOpen(false);
        setRenameTarget(null);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setCreateOpen(false);
        setRenameTarget(null);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [createOpen, renameTarget]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl
                   w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">标签: {title}</h2>
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            勾选应用标签 · 行尾管理
          </span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        {/* Search + tag list */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="px-4 pt-3 pb-2 shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标签..."
              className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded
                         text-slate-200 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">
                {categories.length === 0 ? "暂无标签" : "无匹配标签"}
              </p>
            ) : (
              filtered.map((c) => {
                const checked = current.includes(c.id);
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 ${
                      checked ? "bg-blue-950/30" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTag(c.id)}
                      className="accent-blue-500 shrink-0"
                    />
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: c.color ?? "#3b82f6" }}
                    />
                    <span className={`text-xs flex-1 truncate ${checked ? "text-slate-100" : "text-slate-300"}`}>
                      {c.name}
                    </span>
                    {/* Inline actions */}
                    <label
                      className="relative shrink-0 cursor-pointer"
                      title="改色"
                    >
                      <input
                        type="color"
                        value={c.color ?? "#3b82f6"}
                        onChange={(e) => setTagColor(c.id, e.target.value)}
                        className="w-0 h-0 opacity-0 absolute"
                      />
                      <span className="text-[10px] text-slate-500 hover:text-slate-200">🎨</span>
                    </label>
                    <button
                      onClick={() => openRename(c.id, c.name)}
                      title="重命名"
                      className="text-[10px] px-1.5 py-0.5 text-slate-500 hover:text-amber-300 rounded cursor-pointer shrink-0"
                    >
                      改名
                    </button>
                    <button
                      onClick={() => removeTag(c.id)}
                      title="删除"
                      className="text-[10px] px-1.5 py-0.5 text-slate-500 hover:text-red-400 rounded cursor-pointer shrink-0"
                    >
                      删除
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer: new-tag button + cancel/done */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
          <button
            onClick={openCreate}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            + 新建标签
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">已选 {current.length} 个</span>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              完成
            </button>
          </div>
        </div>
      </div>

      {/* Create / rename dialog (shared) */}
      {(createOpen || renameTarget) && (
        <div
          ref={dialogRef}
          className="fixed z-[400] bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 w-80"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <p className="text-xs font-medium text-slate-200 mb-2">
            {createOpen ? "新建标签" : `重命名「${renameTarget!.name}」`}
          </p>
          <input
            value={createOpen ? createName : renameValue}
            onChange={(e) =>
              createOpen ? setCreateName(e.target.value) : setRenameValue(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (createOpen) confirmCreate();
                else confirmRename();
              }
            }}
            autoFocus
            placeholder="标签名称..."
            className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded
                       text-slate-200 outline-none focus:border-blue-500 mb-3"
          />
          {createOpen && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-400 shrink-0">颜色:</span>
              <input
                type="color"
                value={createColor}
                onChange={(e) => setCreateColor(e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border border-slate-600"
              />
              <span className="text-[10px] text-slate-500 font-mono">{createColor}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setCreateOpen(false);
                setRenameTarget(null);
              }}
              className="text-xs px-3 py-1 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={() => {
                if (createOpen) confirmCreate();
                else confirmRename();
              }}
              disabled={createOpen ? !createName.trim() : !renameValue.trim()}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
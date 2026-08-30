import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

/**
 * Tag manager window — same modal shell & interaction as AddModPanel
 * (fixed overlay + centered panel with header / content / footer).
 * Left: checkbox the current mod's tags. Right: manage tags (dropdown input,
 * native color picker, create / rename / recolor / delete).
 */
export default function CategoryPicker({ modKey, title, onClose }: Props) {
  const categories = useCategoryStore((s) => s.categories);
  const modCats = useCategoryStore((s) => s.modCats);
  const setModCategories = useCategoryStore((s) => s.setModCategories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const renameCategory = useCategoryStore((s) => s.renameCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);

  const current = useMemo(() => modCats[modKey] ?? [], [modCats, modKey]);

  const [input, setInput] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);

  const matched = useMemo(() => {
    const t = input.trim();
    return categories.find((c) => c.name === t) ?? null;
  }, [categories, input]);

  const selectedTag = matched;

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

  const handleCreate = () => {
    const name = input.trim();
    if (!name) return;
    addCategory(name, color);
    setInput("");
    persistCategories(useCategoryStore.getState());
  };

  const openRename = () => {
    if (!matched) return;
    setRenameValue(matched.name);
    setRenameOpen(true);
  };

  const confirmRename = () => {
    if (!matched) return;
    const next = renameValue.trim();
    if (next && next !== matched.name) {
      renameCategory(matched.id, next);
      persistCategories(useCategoryStore.getState());
      setInput(next);
    }
    setRenameOpen(false);
  };

  const changeColor = (c: string) => {
    setColor(c);
    if (matched) {
      const state = useCategoryStore.getState();
      useCategoryStore.setState({
        categories: state.categories.map((cat) =>
          cat.id === matched.id ? { ...cat, color: c } : cat,
        ),
      });
      persistCategories(useCategoryStore.getState());
    }
  };

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

  useEffect(() => {
    if (!renameOpen) return;
    const handler = (e: MouseEvent) => {
      if (renameRef.current && !renameRef.current.contains(e.target as Node)) {
        setRenameOpen(false);
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRenameOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [renameOpen]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl
                   w-[760px] max-w-[95vw] max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">标签: {title}</h2>
          <span className="text-[10px] text-slate-500 hidden sm:inline">勾选当前 Mod 标签 · 管理自定义标签</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex min-h-0">
          <div className="w-1/2 border-r border-slate-700 p-4">
            <p className="text-xs text-slate-400 mb-2">当前 Mod 标签</p>
            {categories.length === 0 ? (
              <p className="text-xs text-slate-600 py-6 text-center">暂无自定义标签</p>
            ) : (
              <div className="space-y-1">
                {categories.map((c) => {
                  const checked = current.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTag(c.id)}
                        className="accent-blue-500"
                      />
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ background: c.color ?? "#3b82f6" }}
                      />
                      <span className={`text-xs flex-1 truncate ${checked ? "text-slate-200" : "text-slate-400"}`}>
                        {c.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-1 p-4">
            <p className="text-xs text-slate-400 mb-2">管理标签（输入或选择已有标签）</p>
            <input
              list="tag-options"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入新标签名或选择已有标签..."
              className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded
                         text-slate-200 outline-none focus:border-blue-500 mb-3"
            />
            <datalist id="tag-options">
              {categories.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>

            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-400 shrink-0">颜色:</span>
              <input
                type="color"
                value={matched?.color ?? color}
                onChange={(e) => changeColor(e.target.value)}
                className="w-8 h-7 rounded cursor-pointer bg-transparent border border-slate-600"
              />
              <span className="text-[10px] text-slate-500 font-mono">
                {matched?.color ?? color}
              </span>
            </div>

            {selectedTag ? (
              <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-700/50 rounded px-2 py-1.5 mb-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: selectedTag.color ?? "#3b82f6" }}
                />
                <span className="truncate flex-1">{selectedTag.name}</span>
                <button
                  onClick={openRename}
                  className="text-[10px] px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer shrink-0"
                >
                  重命名
                </button>
                <button
                  onClick={() => {
                    deleteCategory(selectedTag.id);
                    persistCategories(useCategoryStore.getState());
                    setInput("");
                  }}
                  title="删除此标签"
                  className="text-[10px] px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer shrink-0"
                >
                  删除
                </button>
              </div>
            ) : (
              <div className="text-[10px] text-slate-600 mb-3">
                {input.trim() ? "输入内容与已有标签不同 → 点击下方「新建」创建" : "选择已有标签进行重命名/改色/删除，或输入新名称新建"}
              </div>
            )}

            <div className="flex justify-end">
              {matched ? (
                <button
                  onClick={openRename}
                  className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
                >
                  重命名
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={!input.trim()}
                  className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
                >
                  新建
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
          <span className="text-xs text-slate-500">
            已选 {current.length} 个标签
          </span>
          <div className="flex gap-2">
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

      {renameOpen && matched && (
        <div
          ref={renameRef}
          className="fixed z-[160] bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 w-72"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <p className="text-xs font-medium text-slate-200 mb-2">
            重命名标签「{matched.name}」
          </p>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmRename()}
            autoFocus
            className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded
                       text-slate-200 outline-none focus:border-blue-500 mb-3"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRenameOpen(false)}
              className="text-xs px-3 py-1 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={confirmRename}
              disabled={!renameValue.trim()}
              className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded cursor-pointer"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
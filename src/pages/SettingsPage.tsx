import { useCallback, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { validateGamePath, openLogDir } from "../lib/tauriApi";
import { useAppStore } from "../store/useAppStore";
import { useCategoryStore } from "../store/useCategoryStore";
import { useNoteStore } from "../store/useNoteStore";
import { useCollectionStore } from "../store/useCollectionStore";

interface Props {
  gamePath: string | null;
  onPathSelected: (path: string) => void;
  /** Reselect current path (clears mods and returns to path picker). */
  onReselect?: () => void;
}

/** Settings page — game path, mod paths, data management. */
export default function SettingsPage({ gamePath, onPathSelected, onReselect }: Props) {
  const setError = useAppStore((s) => s.setError);
  const detecting = useAppStore((s) => s.detecting);
  const setDetecting = useAppStore((s) => s.setDetecting);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSelectFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (!selected) return;
    setDetecting(true);
    setError(null);
    try {
      const result = await validateGamePath(selected as string);
      if (result.path) {
        onPathSelected(result.path);
        flash("游戏路径已更新");
      } else {
        setError("所选目录中未找到 The Scroll of Taiwu.exe");
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("PERMISSION_DENIED")) setError("所选目录无读取权限");
      else if (msg.includes("PATH_NOT_FOUND")) setError("所选目录不可用，可能磁盘已断开");
      else setError(`验证失败: ${msg}`);
    } finally {
      setDetecting(false);
    }
  }, [setDetecting, setError, onPathSelected]);

  const handleClearCats = () => {
    useCategoryStore.setState({ categories: [], modCats: {} });
    try { localStorage.removeItem("twm-mod-categories"); } catch { /* ignore */ }
    flash("自定义分类已清除");
  };
  const handleClearNotes = () => {
    useNoteStore.setState({ notes: {} });
    try { localStorage.removeItem("twm-mod-notes"); } catch { /* ignore */ }
    flash("Mod 备注已清除");
  };
  const handleClearCollections = () => {
    useCollectionStore.setState({ collections: [] });
    try { localStorage.removeItem("twm-mod-collections"); } catch { /* ignore */ }
    flash("集合已清除");
  };
  const handleClearFilterPrefs = () => {
    try { localStorage.removeItem("twm-filter-prefs"); } catch { /* ignore */ }
    flash("筛选缓存已清除");
  };

  // ★ v5: mod paths — custom overrides (persisted) with auto-derive fallback
  const MOD_PATHS_KEY = "twm-mod-paths";
  function loadModPaths(): { workshop: string | null; local: string | null } {
    try {
      const raw = localStorage.getItem(MOD_PATHS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { workshop: p.workshop ?? null, local: p.local ?? null };
      }
    } catch { /* ignore */ }
    return { workshop: null, local: null };
  }
  const derivedWorkshop = gamePath
    ? gamePath.replace(/[\\/]common[\\/][^\\/]+$/, "") + "\\workshop\\content\\838350"
    : null;
  const derivedLocal = gamePath ? `${gamePath}\\Mod` : null;
  const [customPaths, setCustomPaths] = useState(loadModPaths);
  const workshopPath = customPaths.workshop ?? derivedWorkshop;
  const localModPath = customPaths.local ?? derivedLocal;
  const workshopCustom = !!customPaths.workshop;
  const localCustom = !!customPaths.local;

  const persistModPaths = (next: { workshop: string | null; local: string | null }) => {
    setCustomPaths(next);
    try { localStorage.setItem(MOD_PATHS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    flash("Mod 路径已保存");
  };
  const handleAutoDerive = () => {
    persistModPaths({ workshop: null, local: null });
  };
  const handleWorkshopChange = (v: string) => {
    persistModPaths({ workshop: v.trim() || null, local: customPaths.local });
  };
  const handleLocalChange = (v: string) => {
    persistModPaths({ workshop: customPaths.workshop, local: v.trim() || null });
  };
  const handlePickWorkshop = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) handleWorkshopChange(selected as string);
  };
  const handlePickLocal = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) handleLocalChange(selected as string);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">设置</span>
        <span className="text-xs text-slate-500">路径与数据管理</span>
      </div>

      {message && (
        <div className="px-6 py-1.5 text-xs text-green-400 bg-green-900/20 border-b border-green-800 shrink-0">
          {message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6 max-w-2xl w-full mx-auto">
        {/* Game path */}
        <section className="border border-slate-700 rounded-lg p-3 sm:p-4 bg-slate-800/50">
          <h3 className="text-sm font-medium text-slate-200 mb-3">游戏路径</h3>
          <div className="flex items-center gap-2 sm:gap-3">
            <code className="flex-1 min-w-0 text-xs text-slate-400 bg-slate-900 rounded px-2 py-1.5 truncate">
              {gamePath ?? "未配置"}
            </code>
            <button
              onClick={handleSelectFolder}
              disabled={detecting}
              className="text-xs px-2 sm:px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                         text-white rounded cursor-pointer shrink-0"
            >
              {detecting ? "验证中..." : "选择游戏目录"}
            </button>
            {onReselect && (
              <button
                onClick={onReselect}
                className="text-xs px-2 sm:px-3 py-1.5 border border-slate-600 text-slate-400
                           hover:text-slate-200 rounded cursor-pointer shrink-0"
              >
                重新选择
              </button>
            )}
          </div>
        </section>

        {/* Mod paths */}
        <section className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Mod 路径</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-20 shrink-0">工坊目录</span>
              <input
                value={workshopPath ?? ""}
                onChange={(e) => handleWorkshopChange(e.target.value)}
                placeholder="需先配置游戏路径"
                className="flex-1 text-xs px-2 py-1.5 bg-slate-900 border border-slate-600 rounded
                           text-slate-300 outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => void handlePickWorkshop()}
                className="text-xs px-2 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer shrink-0"
              >
                浏览
              </button>
              {workshopCustom && (
                <span className="text-[10px] text-purple-400 shrink-0">自定义</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-20 shrink-0">本地目录</span>
              <input
                value={localModPath ?? ""}
                onChange={(e) => handleLocalChange(e.target.value)}
                placeholder="需先配置游戏路径"
                className="flex-1 text-xs px-2 py-1.5 bg-slate-900 border border-slate-600 rounded
                           text-slate-300 outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => void handlePickLocal()}
                className="text-xs px-2 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer shrink-0"
              >
                浏览
              </button>
              {localCustom && (
                <span className="text-[10px] text-purple-400 shrink-0">自定义</span>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleAutoDerive}
                className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
              >
                自动推导
              </button>
              <p className="text-slate-600 text-[10px] flex-1">
                默认由游戏路径推导（工坊: steamapps/workshop/content/838350，本地: Mod/）；点"自动推导"恢复
              </p>
            </div>
          </div>
        </section>

        {/* Data management */}
        <section className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
          <h3 className="text-sm font-medium text-slate-200 mb-3">数据管理</h3>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleClearFilterPrefs} className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer">
              清除筛选缓存
            </button>
            <button onClick={handleClearCats} className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer">
              清除自定义分类
            </button>
            <button onClick={handleClearNotes} className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer">
              清除 Mod 备注
            </button>
            <button onClick={handleClearCollections} className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer">
              清除集合
            </button>
            <button
              onClick={() => openLogDir().catch(() => {})}
              className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:border-slate-400 rounded cursor-pointer"
            >
              打开日志目录
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

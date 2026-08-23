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
}

/** Settings page — game path, mod paths, data management. */
export default function SettingsPage({ gamePath, onPathSelected }: Props) {
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

  // Derived mod paths from game root
  const workshopPath = gamePath
    ? gamePath.replace(/[\\/]common[\\/][^\\/]+$/, "") + "\\workshop\\content\\838350"
    : null;
  const localModPath = gamePath ? `${gamePath}\\Mod` : null;

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

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 max-w-2xl">
        {/* Game path */}
        <section className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
          <h3 className="text-sm font-medium text-slate-200 mb-3">游戏路径</h3>
          <div className="flex items-center gap-3">
            <code className="flex-1 text-xs text-slate-400 bg-slate-900 rounded px-2 py-1.5 truncate">
              {gamePath ?? "未配置"}
            </code>
            <button
              onClick={handleSelectFolder}
              disabled={detecting}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                         text-white rounded cursor-pointer shrink-0"
            >
              {detecting ? "验证中..." : "选择游戏目录"}
            </button>
          </div>
        </section>

        {/* Mod paths */}
        <section className="border border-slate-700 rounded-lg p-4 bg-slate-800/50">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Mod 路径</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-20 shrink-0">工坊目录</span>
              <code className="flex-1 text-slate-400 bg-slate-900 rounded px-2 py-1 truncate">
                {workshopPath ?? "需先配置游戏路径"}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 w-20 shrink-0">本地目录</span>
              <code className="flex-1 text-slate-400 bg-slate-900 rounded px-2 py-1 truncate">
                {localModPath ?? "需先配置游戏路径"}
              </code>
            </div>
            <p className="text-slate-600 text-[10px]">
              由游戏路径自动推导（工坊: steamapps/workshop/content/838350，本地: {gamePath ? gamePath + "\\Mod" : "Mod/"}）
            </p>
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

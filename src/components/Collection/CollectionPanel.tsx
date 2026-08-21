import { useState, useEffect } from "react";
import { save, open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "../../lib/tauriApi";
import { useCollectionStore } from "../../store/useCollectionStore";
import { detectMissingMods } from "../../utils/migrateProfile";
import type { ModInfo } from "../../lib/types";
import MissingModsDialog from "../ProfileManager/MissingModsDialog";
import type { ModMeta } from "../../lib/types";

interface Props {
  mods: ModInfo[];
  onClose: () => void;
  /** Build a new scheme from a collection (delegated to ProfileManager). */
  onCreateSchemeFromCollection: (collectionId: string) => void;
  /** ★ v2: optional seed from list multi-select ("save selection as collection") */
  seed?: { modKeys: string[]; modMeta: Record<string, ModMeta> } | null;
}

/** Offline collection panel — create/delete/import/export mod bundles. */
export default function CollectionPanel({ mods, onClose, onCreateSchemeFromCollection, seed }: Props) {
  const collections = useCollectionStore((s) => s.collections);
  const create = useCollectionStore((s) => s.create);
  const remove = useCollectionStore((s) => s.remove);
  const importJson = useCollectionStore((s) => s.importJson);
  const exportJson = useCollectionStore((s) => s.exportJson);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingColId, setPendingColId] = useState<string | null>(null);

  // ★ v2: when opened from list multi-select, prefill the create form
  useEffect(() => {
    if (seed && seed.modKeys.length > 0) {
      setShowCreate(true);
      setName(`集合 ${new Date().toLocaleDateString("zh-CN")}`);
    }
  }, [seed]);

  const flash = (text: string, type: "ok" | "error" = "ok") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  const handleCreate = () => {
    const n = name.trim() || "新建集合";
    // Use seed members if provided (list multi-select), else all installed mods
    const members = seed && seed.modKeys.length > 0 ? seed.modKeys : mods.map((m) => `${m.source}_${m.fileId}`);
    const modMeta: Record<string, ModMeta> = seed && Object.keys(seed.modMeta).length > 0
      ? seed.modMeta
      : (() => {
          const meta: Record<string, ModMeta> = {};
          for (const m of mods) {
            const key = `${m.source}_${m.fileId}`;
            const item: ModMeta = { title: m.title, author: m.author, source: m.source, fileId: m.fileId };
            if (m.version) item.version = m.version;
            meta[key] = item;
          }
          return meta;
        })();
    create({
      name: n,
      description: desc.trim() || undefined,
      modKeys: members,
      modMeta,
    });
    setShowCreate(false);
    setName("");
    setDesc("");
    flash(`集合 "${n}" 已创建（${members.length} 个 Mod）`);
  };

  const handleExport = async (id: string, colName: string) => {
    const raw = exportJson(id);
    if (!raw) return;
    const path = await save({
      defaultPath: `${colName}.collection.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      await writeFile(path, raw);
      flash(`集合 "${colName}" 已导出`);
    } catch (e) {
      flash(`导出失败: ${String(e)}`, "error");
    }
  };

  const handleImport = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected) return;
    const path = selected as string;
    let raw: string;
    try {
      raw = await readFile(path);
    } catch (e) {
      flash(`读取失败: ${String(e)}`, "error");
      return;
    }
    const result = importJson(raw);
    if (!result.ok) {
      flash(result.error ?? "导入失败", "error");
      return;
    }
    // Detect missing mods from the newly imported collection
    const store = useCollectionStore.getState();
    const imported = store.collections.find((c) => c.name === nameOfImported(raw));
    if (imported) {
      const missing = detectMissingMods(
        { enabledMods: [], modKeys: imported.modKeys, groups: imported.groups, modMeta: imported.modMeta },
        mods,
      );
      if (missing.size > 0) {
        setMissingMods(missing);
        setPendingColId(imported.id);
        return;
      }
    }
    flash("集合已导入");
  };

  const handleDelete = async (id: string, colName: string) => {
    const confirmed = await ask(
      `确定要删除集合 "${colName}" 吗？此操作不可撤销。`,
      { title: "确认删除", kind: "warning" },
    );
    if (!confirmed) return;
    remove(id);
    flash(`集合 "${colName}" 已删除`);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">Mod 集合</span>
        <span className="text-xs text-slate-500">离线分组包 · 新建方案的快速模板</span>
        <div className="flex-1" />
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            + 新建集合
          </button>
        )}
        <button
          onClick={handleImport}
          className="text-xs px-2.5 py-1 border border-slate-600 text-slate-400
                     hover:text-slate-200 rounded cursor-pointer"
        >
          导入
        </button>
        <button
          onClick={onClose}
          className="text-xs px-2.5 py-1 border border-slate-600 text-slate-400
                     hover:text-slate-200 rounded cursor-pointer"
        >
          关闭
        </button>
      </div>

      {message && (
        <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-[100] px-4 py-1.5 text-sm rounded shadow-lg ${
          message.type === "ok" ? "bg-green-700 text-green-100" : "bg-red-700 text-red-100"
        }`}>
          {message.text}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {showCreate && (
          <div className="mb-4 p-4 border border-blue-700/50 rounded-lg bg-blue-950/20 space-y-2">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="集合名称..."
                className="flex-1 text-xs px-2 py-1.5 bg-slate-800 border border-slate-600 rounded
                           text-slate-200 outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                onClick={handleCreate}
                className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
              >
                创建
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-2 py-1.5 border border-slate-600 text-slate-400 rounded cursor-pointer"
              >
                取消
              </button>
            </div>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="描述（可选，如：画质整合、剧情扩展）..."
              className="w-full text-xs px-2 py-1.5 bg-slate-800 border border-slate-600 rounded
                         text-slate-200 outline-none focus:border-blue-500"
            />
            <p className="text-[10px] text-slate-500">
              创建时将收录当前全部已安装 Mod（{mods.length} 个）。如需只收录部分 Mod，可在列表多选后右键「保存为集合」。
            </p>
          </div>
        )}

        {collections.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-12">
            暂无集合。可「新建集合」收录全部 Mod，或在列表多选后右键「保存为集合」。
          </p>
        ) : (
          <div className="space-y-2">
            {collections.map((col) => (
              <div
                key={col.id}
                className="flex items-center gap-3 p-3 border border-slate-700 rounded-lg bg-slate-800/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200 truncate">{col.name}</span>
                    <span className="text-xs text-slate-500 shrink-0">{col.modKeys.length} Mod</span>
                    {(col.groups?.length ?? 0) > 0 && (
                      <span className="text-xs text-slate-500 shrink-0">{col.groups!.length} 分组</span>
                    )}
                  </div>
                  {col.description && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{col.description}</p>
                  )}
                </div>
                <button
                  onClick={() => onCreateSchemeFromCollection(col.id)}
                  className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer shrink-0"
                  title="用该集合的 Mod 快速创建新方案"
                >
                  从集合创建方案
                </button>
                <button
                  onClick={() => handleExport(col.id, col.name)}
                  className="text-xs px-2 py-1 border border-slate-500 text-slate-400
                             hover:text-slate-200 rounded cursor-pointer shrink-0"
                >
                  导出
                </button>
                <button
                  onClick={() => handleDelete(col.id, col.name)}
                  className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer shrink-0"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {missingMods && (
        <MissingModsDialog
          missing={missingMods}
          onClose={() => {
            setMissingMods(null);
            if (pendingColId) {
              const col = useCollectionStore.getState().collections.find((c) => c.id === pendingColId);
              flash(col ? `集合 "${col.name}" 已导入（${missingMods.size} 个 Mod 缺失）` : "集合已导入");
              setPendingColId(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Best-effort: read the "name" field from a raw imported JSON for lookup. */
function nameOfImported(raw: string): string {
  try {
    return JSON.parse(raw).name ?? "";
  } catch {
    return "";
  }
}

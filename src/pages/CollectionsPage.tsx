import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollectionStore } from "../store/useCollectionStore";
import { useAppStore } from "../store/useAppStore";
import { useConflictDetection } from "../hooks/useConflictDetection";
import { loadScheme, addModsToScheme, saveScheme, buildModMeta } from "../utils/schemeMembers";
import type { ModInfo, ModMeta } from "../lib/types";
import ModCard from "../components/ModList/ModCard";
import ModActionMenu from "../components/common/ModActionMenu";
import AddModPanel from "../components/common/AddModPanel";

interface Props {
  mods: ModInfo[];
  onCreateSchemeFromCollection: (collectionId: string) => void;
  /** Cross-page creation seed (from ModsPage multi-select → save as collection). */
  seed?: { modKeys: string[]; modMeta: Record<string, ModMeta> } | null;
  onSeedConsumed?: () => void;
}

/** Collection management page — bundle lifecycle + member browse + conflicts + add. */
export default function CollectionsPage({
  mods,
  onCreateSchemeFromCollection,
  seed,
  onSeedConsumed,
}: Props) {
  const collections = useCollectionStore((s) => s.collections);
  const create = useCollectionStore((s) => s.create);
  const remove = useCollectionStore((s) => s.remove);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; key: string; mod: ModInfo;
  } | null>(null);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const seedHandledRef = useRef(false);

  const selected = collections.find((c) => c.id === selectedId) ?? null;

  // Seed → auto-create a collection from the passed mod keys (once)
  useEffect(() => {
    if (!seed || seed.modKeys.length === 0 || seedHandledRef.current) return;
    seedHandledRef.current = true;
    const col = create({
      name: `集合 ${new Date().toLocaleDateString("zh-CN")}`,
      modKeys: seed.modKeys,
      modMeta: seed.modMeta,
    });
    setSelectedId(col.id);
    setShowNew(true);
    setNewName(col.name);
    onSeedConsumed?.();
  }, [seed, create, onSeedConsumed]);

  const memberSet = useMemo(() => new Set(selected?.modKeys ?? []), [selected]);
  const memberMods = useMemo(
    () => mods.filter((m) => memberSet.has(`${m.source}_${m.fileId}`)),
    [mods, memberSet],
  );

  // Conflict detection within the selected collection's member scope
  const { conflictMap } = useConflictDetection(
    mods,
    { modKeys: selected?.modKeys ?? [], onlyEnabled: false },
  );
  const modTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mods) map[`${m.source}_${m.fileId}`] = m.title;
    return map;
  }, [mods]);

  const handleRemoveMember = useCallback(
    (key: string) => {
      if (!selected) return;
      const store = useCollectionStore.getState();
      const updated = store.collections.map((c) =>
        c.id === selected.id
          ? { ...c, modKeys: c.modKeys.filter((k) => k !== key), updatedAt: new Date().toISOString() }
          : c,
      );
      useCollectionStore.setState({ collections: updated });
      try {
        localStorage.setItem("twm-mod-collections", JSON.stringify(updated));
      } catch { /* ignore */ }
    },
    [selected],
  );

  const contextKeys = useMemo(() => (contextMenu ? [contextMenu.key] : []), [contextMenu]);
  const menuMod = useMemo(() => {
    if (!contextMenu) return undefined;
    const m = contextMenu.mod;
    return { key: contextMenu.key, fileId: m.fileId, source: m.source, dirPath: m.dirPath, enabled: false };
  }, [contextMenu]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">集合管理</span>
        <span className="text-xs text-slate-500">离线分组包 · 成员浏览 · 冲突提示</span>
        <div className="flex-1" />
        {!showNew ? (
          <button
            onClick={() => setShowNew(true)}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            + 新建集合
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  const col = create({ name: newName.trim(), modKeys: [], modMeta: {} });
                  setSelectedId(col.id);
                  setShowNew(false);
                  setNewName("");
                }
              }}
              placeholder="集合名称..."
              className="text-xs px-2 py-1 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none w-40"
              autoFocus
            />
            <button
              onClick={() => {
                const col = create({ name: newName.trim() || "未命名集合", modKeys: [], modMeta: {} });
                setSelectedId(col.id);
                setShowNew(false);
                setNewName("");
              }}
              className="text-xs px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
            >
              创建
            </button>
            <button
              onClick={() => setShowNew(false)}
              className="text-xs px-2 py-1 border border-slate-600 text-slate-400 rounded cursor-pointer"
            >
              取消
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Collection list */}
        <div className="w-56 shrink-0 border-r border-slate-700 overflow-y-auto p-2 space-y-1">
          <p className="text-[10px] text-slate-500 px-1 py-1">集合列表</p>
          {collections.length === 0 && (
            <p className="text-xs text-slate-600 px-1 py-2">暂无集合</p>
          )}
          {collections.map((c) => {
            const selectedFlag = selectedId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`px-2 py-1.5 rounded cursor-pointer transition-colors text-xs ${
                  selectedFlag
                    ? "bg-purple-900/40 border border-purple-700/50"
                    : "hover:bg-slate-700/50 border border-transparent"
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className={`flex-1 truncate ${selectedFlag ? "text-purple-300" : "text-slate-300"}`}>
                    {c.name}
                  </span>
                  <span className="text-slate-500 text-[10px]">{c.modKeys.length}</span>
                </div>
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreateSchemeFromCollection(c.id);
                    }}
                    className="text-[9px] px-1 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
                  >
                    建方案
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(c.id);
                      if (selectedId === c.id) setSelectedId(null);
                    }}
                    className="text-[9px] px-1 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Member list */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/60 shrink-0">
            <span className="text-xs text-slate-400 truncate">
              {selected ? `成员: ${selected.name}` : "选择一个集合查看成员"}
            </span>
            <span className="text-xs text-slate-600">
              {selected ? `${memberMods.length} 个` : ""}
            </span>
            <div className="flex-1" />
            {selected && (
              <button
                onClick={() => setAddOpen(true)}
                className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
              >
                ＋ 添加 Mod
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {!selected ? (
              <p className="text-sm text-slate-500 text-center py-12">从左侧选择一个集合</p>
            ) : memberMods.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12">
                <p className="text-sm text-slate-500">该集合暂无成员</p>
                <button
                  onClick={() => setAddOpen(true)}
                  className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
                >
                  ＋ 添加第一个 Mod
                </button>
              </div>
            ) : (
              memberMods.map((m) => {
                const key = `${m.source}_${m.fileId}`;
                return (
                  <div
                    key={key}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, key, mod: m });
                    }}
                  >
                    <ModCard
                      mod={m}
                      disabled
                      onToggle={() => {}}
                      onSelect={() => {}}
                      conflicts={conflictMap.get(key)}
                      modTitles={modTitles}
                      viewMode="detailed"
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Add-mods panel */}
      {addOpen && selected && (
        <AddModPanel
          mods={mods}
          existingKeys={memberSet}
          targetLabel={selected.name}
          onAdd={(keys) => {
            useCollectionStore.getState().addModsToCollection(selected.id, keys, buildModMeta(mods, keys));
            setLastMessage(`已加入集合 "${selected.name}"`);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Mod action menu */}
      {contextMenu && menuMod && (
        <ModActionMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          modTitle={contextMenu.mod.title}
          mod={menuMod}
          schemes={[]}
          collections={collections}
          containerKind="collection"
          onAddToScheme={async (name) => {
            const target = await loadScheme(name);
            if (target) {
              const next = addModsToScheme(target, contextKeys, buildModMeta(mods, contextKeys));
              await saveScheme(next);
              setLastMessage(`已加入方案 "${name}"`);
            }
          }}
          onAddToCollection={(id) => {
            useCollectionStore.getState().addModsToCollection(id, contextKeys, buildModMeta(mods, contextKeys));
            setLastMessage("已加入集合");
          }}
          onCreateScheme={() => setLastMessage("请到方案页创建新方案")}
          onCreateCollection={() => setLastMessage("请使用上方新建集合")}
          onRemoveFromContainer={() => handleRemoveMember(contextMenu.key)}
        />
      )}
    </div>
  );
}

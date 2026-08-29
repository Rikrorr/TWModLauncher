import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCollectionStore } from "../store/useCollectionStore";
import { useAppStore } from "../store/useAppStore";
import { useConflictDetection } from "../hooks/useConflictDetection";
import { loadScheme, addModsToScheme, saveScheme, buildModMeta, buildModSettings } from "../utils/schemeMembers";
import type { ModInfo, ModMeta } from "../lib/types";
import ModActionMenu from "../components/common/ModActionMenu";
import AddModPanel from "../components/common/AddModPanel";
import ContainerSelect from "../components/common/ContainerSelect";
import CreateDialog from "../components/common/CreateDialog";
import SettingsEditor from "../components/SettingsEditor/SettingsEditor";
import MemberModList from "../components/ModList/MemberModList";

interface Props {
  mods: ModInfo[];
  onCreateSchemeFromCollection: (collectionId: string) => void;
  /** Cross-page creation seed (from ModsPage multi-select → save as collection). */
  seed?: {
    modKeys: string[];
    modMeta: Record<string, ModMeta>;
    modSettings?: Record<string, Record<string, unknown>>;
  } | null;
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
  // ★ v3: edit selection lifted to global store (persisted across page switches)
  const selectedId = useAppStore((s) => s.collectionEditId);
  const setSelectedId = useAppStore((s) => s.setCollectionEditId);
  const [addOpen, setAddOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; key: string; mod: ModInfo;
  } | null>(null);
  // ★ v3: per-collection mod config editor (snapshot → collection.modSettings)
  const [configModKey, setConfigModKey] = useState<string | null>(null);
  // ★ v3: create-collection modal (replaces inline input)
  const [createOpen, setCreateOpen] = useState(false);
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
      modSettings: seed.modSettings,
    });
    setSelectedId(col.id);
    onSeedConsumed?.();
  }, [seed, create, onSeedConsumed, setSelectedId]);

  const memberSet = useMemo(() => new Set(selected?.modKeys ?? []), [selected]);
  const memberMods = useMemo(
    () =>
      mods
        .filter((m) => memberSet.has(`${m.source}_${m.fileId}`))
        .map((m) => {
          const key = `${m.source}_${m.fileId}`;
          // ★ v3: show the collection's settings snapshot (falls back to read-mods base)
          const snap = selected?.modSettings?.[key];
          return {
            ...m,
            currentSettings:
              snap && Object.keys(snap).length > 0 ? snap : m.currentSettings,
          };
        }),
    [mods, memberSet, selected],
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

        {/* Collection selector dropdown (delete + create-scheme inside) */}
        <ContainerSelect
          placeholder="选择集合..."
          options={collections.map((c) => ({
            key: c.id,
            label: c.name,
            count: c.modKeys.length,
          }))}
          selectedKey={selectedId}
          onSelect={(id) => setSelectedId(id)}
          onDelete={(id) => {
            remove(id);
            if (selectedId === id) setSelectedId(null);
          }}
          headerAction={
            <button
              onClick={() => setCreateOpen(true)}
              className="w-full text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700/70 transition-colors"
            >
              + 新建集合
            </button>
          }
        />

        {!createOpen && (
          <button
            onClick={() => setCreateOpen(true)}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            + 新建集合
          </button>
        )}

        {selected && (
          <>
            <button
              onClick={() => {
                try {
                  localStorage.setItem("twm-mod-collections", JSON.stringify(useCollectionStore.getState().collections));
                  setLastMessage(`集合 "${selected.name}" 已保存`);
                } catch {
                  setLastMessage("保存失败");
                }
              }}
              className="text-xs px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
            >
              保存
            </button>
            <button
              onClick={() => onCreateSchemeFromCollection(selected.id)}
              className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              建方案
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
            >
              ＋ 添加 Mod
            </button>
          </>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Member list — reused filter/view/card stack (read-only) */}
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-slate-500">从上方选择一个集合查看成员</p>
          </div>
        ) : (
          <MemberModList
            mods={memberMods}
            conflictMap={conflictMap}
            modTitles={modTitles}
            readOnly
            onOpenConfig={(key) => setConfigModKey(key)}
            onContextMenu={(e, mod, key) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, key, mod });
            }}
            emptyAction={
              <button
                onClick={() => setAddOpen(true)}
                className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
              >
                ＋ 添加第一个 Mod
              </button>
            }
          />
        )}
      </div>

      {/* Add-mods panel */}
      {addOpen && selected && (
        <AddModPanel
          mods={mods}
          existingKeys={memberSet}
          targetLabel={selected.name}
          onAdd={(keys) => {
            useCollectionStore.getState().addModsToCollection(
              selected.id,
              keys,
              buildModMeta(mods, keys),
              buildModSettings(mods, keys),
            );
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
              const next = addModsToScheme(
                target,
                contextKeys,
                buildModMeta(mods, contextKeys),
                buildModSettings(mods, contextKeys),
              );
              await saveScheme(next);
              setLastMessage(`已加入方案 "${name}"`);
            }
          }}
          onAddToCollection={(id) => {
            useCollectionStore.getState().addModsToCollection(
              id,
              contextKeys,
              buildModMeta(mods, contextKeys),
              buildModSettings(mods, contextKeys),
            );
            setLastMessage("已加入集合");
          }}
          onCreateScheme={() => setLastMessage("请到方案页创建新方案")}
          onCreateCollection={() => setCreateOpen(true)}
          onOpenConfig={() => setConfigModKey(contextMenu.key)}
          onRemoveFromContainer={() => handleRemoveMember(contextMenu.key)}
        />
      )}

      {/* ★ v3: create-collection modal */}
      {createOpen && (
        <CreateDialog
          title="新建集合"
          namePlaceholder="集合名称..."
          showDescription
          defaultName={`集合 ${new Date().toLocaleDateString("zh-CN")}`}
          onSubmit={(name, description) => {
            const col = create({ name, description, modKeys: [], modMeta: {} });
            setSelectedId(col.id);
            setLastMessage(`集合 "${name}" 已创建`);
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* ★ v3: per-collection mod config editor (snapshot → collection.modSettings) */}
      {configModKey && selected && (() => {
        const mod = memberMods.find((m) => `${m.source}_${m.fileId}` === configModKey);
        if (!mod) return null;
        return (
          <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60">
            <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[640px] max-w-[95vw] h-[80vh] max-h-[85vh] flex flex-col overflow-hidden">
              <SettingsEditor
                mod={mod}
                onClose={() => setConfigModKey(null)}
                onSettingsSaved={(settings) => {
                  const store = useCollectionStore.getState();
                  const updated = store.collections.map((c) =>
                    c.id === selected.id
                      ? {
                          ...c,
                          modSettings: {
                            ...(c.modSettings ?? {}),
                            [configModKey]: { ...settings },
                          },
                          updatedAt: new Date().toISOString(),
                        }
                      : c,
                  );
                  useCollectionStore.setState({ collections: updated });
                  try {
                    localStorage.setItem("twm-mod-collections", JSON.stringify(updated));
                  } catch { /* ignore */ }
                }}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

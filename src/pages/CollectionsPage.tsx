import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "../lib/tauriApi";
import { useCollectionStore } from "../store/useCollectionStore";
import { useAppStore } from "../store/useAppStore";
import { loadScheme, addModsToScheme, saveScheme, buildModMeta, buildModSettings, ensureLoadOrder, reorderDisabledToEnd, dateDefaultName } from "../utils/schemeMembers";
import { detectMissingMods } from "../utils/migrateProfile";
import MissingModsDialog from "../components/ProfileManager/MissingModsDialog";
import type { ModGroup, ModInfo, ModMeta, ModCollection } from "../lib/types";
import ModList from "../components/ModList/ModList";
import LoadOrderList from "../components/Scheme/LoadOrderList";
import ModActionMenu from "../components/common/ModActionMenu";
import AddModPanel from "../components/common/AddModPanel";
import ContainerSelect from "../components/common/ContainerSelect";
import CreateDialog from "../components/common/CreateDialog";
import RenameDialog from "../components/common/RenameDialog";
import SettingsEditor from "../components/SettingsEditor/SettingsEditor";

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
  // ★ v2.1: collection display mode — observation (groups) vs load order (flat)
  const [orderView, setOrderView] = useState<"observation" | "load">("observation");
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; key: string; mod: ModInfo;
  } | null>(null);
  // ★ v3: per-collection mod config editor (snapshot → collection.modSettings)
  const [configModKey, setConfigModKey] = useState<string | null>(null);
  // ★ v3: create-collection modal (replaces inline input)
  const [createOpen, setCreateOpen] = useState(false);
  // ★ v2.1: missing-mod warning after importing a collection
  const [importMissingMods, setImportMissingMods] = useState<Map<string, ModMeta> | null>(null);
  // ★ v2.1: rename target (collection id) for the rename dialog
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const seedHandledRef = useRef(false);

  const selected = collections.find((c) => c.id === selectedId) ?? null;

  // ★ v3: container-local multi-select (isolated from the global read-mods selection)
  const [selectedModKeys, setSelectedModKeys] = useState<string[]>([]);
  const [lastClickedKey, setLastClickedKey] = useState<string | null>(null);
  const selectModOnly = useCallback((key: string) => {
    setSelectedModKeys([key]);
    setLastClickedKey(key);
  }, []);
  const toggleSelectMod = useCallback((key: string) => {
    setSelectedModKeys((prev) => {
      const exists = prev.includes(key);
      return exists ? prev.filter((k) => k !== key) : [...prev, key];
    });
    setLastClickedKey(key);
  }, []);
  const addModsToSelection = useCallback((keys: string[]) => {
    setSelectedModKeys((prev) => [...new Set([...prev, ...keys])]);
    if (keys.length > 0) setLastClickedKey(keys[keys.length - 1]);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedModKeys([]);
    setLastClickedKey(null);
  }, []);

  // ★ v3: session-local groups/displayOrder derived from the selected collection
  const [sessionGroups, setSessionGroups] = useState<ModGroup[]>([]);
  const [sessionDisplayOrder, setSessionDisplayOrder] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (!selected) {
        setSessionGroups([]);
        setSessionDisplayOrder([]);
        return;
      }
      // Build ModGroup[] from the collection's preset groups (stable ids) + members
      const groups: ModGroup[] = (selected.groups ?? []).map((g, i) => ({
        id: `cg-${selected.id.slice(0, 8)}-${i}`,
        name: g.name,
        collapsed: false,
        modKeys: g.modKeys.filter((k) => selected.modKeys.includes(k)),
      }));
      const grouped = new Set(groups.flatMap((g) => g.modKeys));
      // ★ v2.1: prefer the persisted display order (survives remounts), else derive
      const persistedOrder = (selected.displayOrder ?? []).filter(
        (k) => groups.some((g) => g.id === k) || selected.modKeys.includes(k),
      );
      const order =
        persistedOrder.length > 0
          ? persistedOrder
          : [
              ...groups.map((g) => g.id),
              ...selected.modKeys.filter((k) => !grouped.has(k)),
            ];
      setSessionGroups(groups);
      setSessionDisplayOrder(order);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ★ v2.1: group/order changes persist BACK into the collection so groups
  // survive view switches / page remounts (the session state rebuilds from the
  // collection data). Updaters compose inside the functional setState — the
  // persisted value is computed from the latest session state.
  const persistCollection = useCallback((fn: (c: ModCollection) => ModCollection) => {
    const store = useCollectionStore.getState();
    const updated = store.collections.map((c) => (c.id === selected?.id ? fn(c) : c));
    useCollectionStore.setState({ collections: updated });
    try {
      localStorage.setItem("twm-mod-collections", JSON.stringify(updated));
    } catch { /* ignore */ }
  }, [selected]);

  const setGroups = useCallback(
    (groups: ModGroup[] | ((prev: ModGroup[]) => ModGroup[])) => {
      setSessionGroups((prev) => {
        const next = typeof groups === "function" ? groups(prev) : groups;
        persistCollection((c) => ({
          ...c,
          groups: next.map((g) => ({ name: g.name, modKeys: g.modKeys })),
          updatedAt: new Date().toISOString(),
        }));
        return next;
      });
    },
    [persistCollection],
  );
  const setDisplayOrder = useCallback(
    (order: string[] | ((prev: string[]) => string[])) => {
      setSessionDisplayOrder((prev) => {
        const next = typeof order === "function" ? order(prev) : order;
        persistCollection((c) => ({
          ...c,
          displayOrder: next,
          updatedAt: new Date().toISOString(),
        }));
        return next;
      });
    },
    [persistCollection],
  );

  // Seed → auto-create a collection from the passed mod keys (once)
  useEffect(() => {
    if (!seed || seed.modKeys.length === 0 || seedHandledRef.current) return;
    seedHandledRef.current = true;
    const col = create({
      name: dateDefaultName("集合"),
      modKeys: seed.modKeys,
      modMeta: seed.modMeta,
      modSettings: seed.modSettings,
    });
    setSelectedId(col.id);
    onSeedConsumed?.();
  }, [seed, create, onSeedConsumed, setSelectedId]);

  const memberSet = useMemo(() => new Set(selected?.modKeys ?? []), [selected]);
  // ★ v2.1: effective member load sequence (legacy collections migrate on use)
  const colLoadOrder = useMemo(
    () => (selected ? ensureLoadOrder(selected) : []),
    [selected],
  );
  const colLoadPosMap = useMemo(() => {
    const map = new Map<string, number>();
    // ★ v2.1: 0-based load order positions
    colLoadOrder.forEach((k, i) => map.set(k, i));
    return map;
  }, [colLoadOrder]);
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
            // ★ v2.1: derived order = position in the load sequence (1-based)
            order: colLoadPosMap.get(key) ?? 0,
            // ★ v2.1: collection-local enable state — defaults to all members
            // enabled when the collection has no explicit enabledMods yet.
            enabled: (selected?.enabledMods ?? selected?.modKeys ?? []).includes(key),
          };
        }),
    [mods, memberSet, selected, colLoadPosMap],
  );
  // Members rendered in load sequence (for the load-order view)
  const colLoadMods = useMemo(() => {
    const byKey = new Map(memberMods.map((m) => [`${m.source}_${m.fileId}`, m]));
    return colLoadOrder
      .map((k) => byKey.get(k))
      .filter((m): m is ModInfo => m !== undefined);
  }, [memberMods, colLoadOrder]);

  // ★ v2.1: toggle a member's enable state — writes ONLY the collection's own
  // enabledMods (never the active scheme / global mod state).
  const handleToggleMember = useCallback(
    (fileId: number, enabled: boolean) => {
      if (!selected) return;
      const mod = mods.find((m) => m.fileId === fileId);
      if (!mod) return;
      const key = `${mod.source}_${mod.fileId}`;
      const store = useCollectionStore.getState();
      const updated = store.collections.map((c) => {
        if (c.id !== selected.id) return c;
        const base = new Set(c.enabledMods ?? c.modKeys);
        if (enabled) base.add(key);
        else base.delete(key);
        const enabledMods = [...base];
        // ★ v2.1: disabled mods drop to the end of the load order, enabled shift up
        const loadOrder = reorderDisabledToEnd(ensureLoadOrder(c), enabledMods);
        return { ...c, enabledMods, loadOrder, updatedAt: new Date().toISOString() };
      });
      useCollectionStore.setState({ collections: updated });
      try { localStorage.setItem("twm-mod-collections", JSON.stringify(updated)); } catch { /* ignore */ }
    },
    [mods, selected],
  );

  // ★ v2.1: order mutations reposition the member within the load sequence
  // (input N = move to 0-based position N; the mod at N and below shift +1)
  const handleOrderChange = useCallback(
    (key: string, order: number) => {
      if (!selected) return;
      const cur = ensureLoadOrder(selected);
      const from = cur.indexOf(key);
      if (from === -1) return;
      const target = Math.max(0, Math.min(cur.length - 1, Math.round(order)));
      if (target === from) return;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(target, 0, key);
      const store = useCollectionStore.getState();
      const updated = store.collections.map((c) =>
        c.id === selected.id
          ? { ...c, loadOrder: next, updatedAt: new Date().toISOString() }
          : c,
      );
      useCollectionStore.setState({ collections: updated });
      try { localStorage.setItem("twm-mod-collections", JSON.stringify(updated)); } catch { /* ignore */ }
    },
    [selected],
  );

  // ★ v2.1: remove one or more members (multi-select context menu)
  const handleRemoveMembers = useCallback(
    (keys: string[]) => {
      if (!selected || keys.length === 0) return;
      const rm = new Set(keys);
      const store = useCollectionStore.getState();
      const updated = store.collections.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              modKeys: c.modKeys.filter((k) => !rm.has(k)),
              enabledMods: c.enabledMods
                ? c.enabledMods.filter((k) => !rm.has(k))
                : undefined,
              loadOrder: c.loadOrder
                ? c.loadOrder.filter((k) => !rm.has(k))
                : undefined,
              updatedAt: new Date().toISOString(),
            }
          : c,
      );
      useCollectionStore.setState({ collections: updated });
      try {
        localStorage.setItem("twm-mod-collections", JSON.stringify(updated));
      } catch { /* ignore */ }
      clearSelection();
    },
    [selected, clearSelection],
  );

  // ★ v2.1: apply the observation display order to the collection load order
  const handleApplyObservationOrder = useCallback(() => {
    if (!selected) return;
    const memberSet = new Set(selected.modKeys ?? []);
    const order: string[] = [];
    for (const k of sessionDisplayOrder) {
      const g = sessionGroups.find((x) => x.id === k);
      if (g) {
        // ★ v2.1: intra-group order follows displayOrder positions, not group order
        const members = g.modKeys
          .filter((mk) => memberSet.has(mk))
          .sort((a, b) => {
            const ia = sessionDisplayOrder.indexOf(a);
            const ib = sessionDisplayOrder.indexOf(b);
            return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
          });
        for (const mk of members) if (!order.includes(mk)) order.push(mk);
      } else if (memberSet.has(k) && !order.includes(k)) {
        order.push(k);
      }
    }
    for (const mk of selected.modKeys ?? []) {
      if (!order.includes(mk)) order.push(mk);
    }
    const store = useCollectionStore.getState();
    const updated = store.collections.map((c) =>
      c.id === selected.id
        ? { ...c, loadOrder: order, updatedAt: new Date().toISOString() }
        : c,
    );
    useCollectionStore.setState({ collections: updated });
    try { localStorage.setItem("twm-mod-collections", JSON.stringify(updated)); } catch { /* ignore */ }
    setLastMessage("已将观测顺序应用到加载顺序");
  }, [selected, sessionDisplayOrder, sessionGroups, setLastMessage]);

  // ★ v2.1: export the selected collection as a JSON file
  const handleExportCollection = useCallback(async () => {
    if (!selected) {
      setLastMessage("请先选择一个集合再导出");
      return;
    }
    const raw = useCollectionStore.getState().exportJson(selected.id);
    if (!raw) {
      setLastMessage("集合导出数据缺失");
      return;
    }
    try {
      const path = await save({
        defaultPath: `${selected.name}.collection.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeFile(path, raw);
      setLastMessage(`集合 "${selected.name}" 已导出`);
    } catch (e) {
      setLastMessage(`导出失败: ${String(e)}`);
    }
  }, [selected, setLastMessage]);

  // ★ v2.1: import a collection from a JSON file
  const handleImportCollection = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!picked) return;
      const raw = await readFile(picked as string);
      const result = useCollectionStore.getState().importJson(raw);
      if (!result.ok) {
        setLastMessage(result.error ?? "导入失败");
        return;
      }
      if (result.collection) {
        setSelectedId(result.collection.id);
        const missing = detectMissingMods(
          {
            enabledMods: [],
            modKeys: result.collection.modKeys,
            groups: result.collection.groups,
            modMeta: result.collection.modMeta,
          },
          mods,
        );
        if (missing.size > 0) {
          setImportMissingMods(missing);
          setLastMessage(`集合已导入，但 ${missing.size} 个 Mod 缺失`);
          return;
        }
      }
      setLastMessage("集合已导入");
    } catch (e) {
      setLastMessage(`导入失败: ${String(e)}`);
    }
  }, [setSelectedId, setLastMessage, mods]);

  // ★ v2.1: rename the selected collection (store + localStorage)
  const handleRenameCollection = useCallback(
    (newName: string) => {
      if (!renameTarget) return;
      const name = newName.trim();
      if (!name) { setLastMessage("名称不能为空"); return; }
      const store = useCollectionStore.getState();
      const updated = store.collections.map((c) =>
        c.id === renameTarget
          ? { ...c, name, updatedAt: new Date().toISOString() }
          : c,
      );
      useCollectionStore.setState({ collections: updated });
      try {
        localStorage.setItem("twm-mod-collections", JSON.stringify(updated));
      } catch { /* ignore */ }
      setLastMessage(`集合已重命名为 "${name}"`);
    },
    [renameTarget, setLastMessage],
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
          onRename={(id) => setRenameTarget(id)}
          headerAction={(close) => (
            <div className="px-2 py-1.5 border-b border-slate-700 flex gap-1">
              <button
                onClick={() => {
                  close();
                  setCreateOpen(true);
                }}
                className="flex-1 px-1.5 py-1 text-xs text-center text-blue-400 hover:bg-slate-700/70 transition-colors"
              >
                新建
              </button>
              <button
                onClick={() => {
                  close();
                  void handleExportCollection();
                }}
                disabled={!selected}
                className="flex-1 px-1.5 py-1 text-xs text-center text-slate-300 hover:bg-slate-700/70 disabled:text-slate-600 disabled:hover:bg-transparent transition-colors"
              >
                导出
              </button>
              <button
                onClick={() => {
                  close();
                  void handleImportCollection();
                }}
                className="flex-1 px-1.5 py-1 text-xs text-center text-slate-300 hover:bg-slate-700/70 transition-colors"
              >
                导入
              </button>
            </div>
          )}
        />


        {selected && (
          <>
            {/* ★ v2.1: display-mode toggle — observation (groups) vs load order (flat) */}
            <div className="flex items-center border border-slate-600 rounded overflow-hidden shrink-0">
              <button
                onClick={() => setOrderView("observation")}
                title="按分组浏览成员"
                className={`text-xs px-2.5 py-1 cursor-pointer transition-colors ${
                  orderView === "observation"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                观测
              </button>
              <button
                onClick={() => setOrderView("load")}
                title="按实际加载顺序排列（独立于分组）"
                className={`text-xs px-2.5 py-1 cursor-pointer transition-colors ${
                  orderView === "load"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                加载
              </button>
            </div>
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
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-slate-500">从上方选择一个集合查看成员</p>
          </div>
        ) : orderView === "load" ? (
          <LoadOrderList
            mods={colLoadMods}
            onMoveUp={(key) => handleOrderChange(key, (colLoadPosMap.get(key) ?? 0) - 1)}
            onMoveDown={(key) => handleOrderChange(key, (colLoadPosMap.get(key) ?? 0) + 1)}
            onMoveToPosition={(key, pos) => handleOrderChange(key, pos)}
            onToggle={handleToggleMember}
          />
        ) : (
          <ModList
            saving={false}
            onSelectMod={(key) => setConfigModKey(key)}
            hideEnabledState
            controlled={{
              mods: memberMods,
              groups: sessionGroups,
              displayOrder: sessionDisplayOrder,
              setGroups,
              setDisplayOrder,
              toggleMod: handleToggleMember,
              setModOrder: (key, order) => handleOrderChange(key, order),
              clearSelection,
              selectedModKeys,
              selectModOnly,
              toggleSelectMod,
              addModsToSelection,
              lastClickedKey,
              setLastClickedKey,
              onApplyOrder: handleApplyObservationOrder,
            }}
            modMenu={{
              schemes: [],
              collections,
              containerKind: "collection",
              onRemoveFromCollection: (keys) => handleRemoveMembers(keys),
              onAddToScheme: (name, keys) =>
                void (async () => {
                  const target = await loadScheme(name);
                  if (target) {
                    const next = addModsToScheme(target, keys, buildModMeta(mods, keys), buildModSettings(mods, keys));
                    await saveScheme(next);
                    setLastMessage(`已加入方案 "${name}"`);
                  }
                })(),
              onAddToCollection: (id, keys) => {
                useCollectionStore.getState().addModsToCollection(id, keys, buildModMeta(mods, keys), buildModSettings(mods, keys));
                setLastMessage("已加入集合");
              },
              onCreateScheme: () => setLastMessage("请到方案页创建新方案"),
              onCreateCollection: () => setCreateOpen(true),
            }}
            onSaveSelectionAsCollection={() => {}}
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
          onRemoveFromContainer={() => handleRemoveMembers(contextKeys)}
        />
      )}

      {/* ★ v3: create-collection modal */}
      {createOpen && (
        <CreateDialog
          title="新建集合"
          namePlaceholder="集合名称..."
          showDescription
          defaultName={dateDefaultName("集合")}
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
          <div
            className="fixed inset-0 z-[170] flex items-center justify-center bg-black/60"
            onClick={() => setConfigModKey(null)}
          >
            <div
              className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl
                         w-[72vw] h-[82vh] max-w-[900px] max-h-[720px]
                         flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
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

      {importMissingMods && (
        <MissingModsDialog
          missing={importMissingMods}
          onClose={() => setImportMissingMods(null)}
        />
      )}

      {renameTarget && (
        <RenameDialog
          title="重命名集合"
          defaultValue={collections.find((c) => c.id === renameTarget)?.name ?? ""}
          onSubmit={(name) => handleRenameCollection(name)}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

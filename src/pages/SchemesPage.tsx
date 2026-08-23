import { useCallback, useEffect, useMemo, useState } from "react";
import { listProfiles, deleteProfile } from "../lib/tauriApi";
import { useAppStore } from "../store/useAppStore";
import { useCollectionStore } from "../store/useCollectionStore";
import { useConflictDetection } from "../hooks/useConflictDetection";
import { loadScheme, saveScheme, addModsToScheme, removeModsFromScheme, buildModMeta } from "../utils/schemeMembers";
import { detectMissingMods } from "../utils/migrateProfile";
import type { ModInfo, ModMeta, ProfileData, ProfileMeta } from "../lib/types";
import ModActionMenu from "../components/common/ModActionMenu";
import AddModPanel from "../components/common/AddModPanel";
import ContainerSelect from "../components/common/ContainerSelect";
import MemberModList from "../components/ModList/MemberModList";
import MissingModsDialog from "../components/ProfileManager/MissingModsDialog";
import { createLogger } from "../lib/logger";

interface Props {
  mods: ModInfo[];
  onActivate: (data: ProfileData) => void;
}

const log = createLogger("SchemesPage");

/** Scheme management page — lifecycle + member editing + conflicts + add-panel. */
export default function SchemesPage({ mods, onActivate }: Props) {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [scheme, setScheme] = useState<ProfileData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingActivate, setPendingActivate] = useState<ProfileData | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; key: string; mod: ModInfo;
  } | null>(null);

  const activeSchemeName = useAppStore((s) => s.activeSchemeName);
  // ★ v3: edit selection lifted to global store (persisted across page switches)
  const selectedName = useAppStore((s) => s.schemeEditName);
  const setSelectedName = useAppStore((s) => s.setSchemeEditName);
  const collections = useCollectionStore((s) => s.collections);
  const setLastMessage = useAppStore((s) => s.setLastMessage);

  const refresh = useCallback(async () => {
    try {
      setProfiles(await listProfiles());
    } catch (e) {
      log.error(`listProfiles failed: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // Load the selected scheme
  useEffect(() => {
    if (!selectedName) {
      const t = setTimeout(() => setScheme(null), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    loadScheme(selectedName).then((data) => {
      if (!cancelled && data) {
        setScheme(data);
        setDirty(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedName]);

  const memberSet = useMemo(() => new Set(scheme?.modKeys ?? []), [scheme]);
  const memberMods = useMemo(
    () => mods.filter((m) => memberSet.has(`${m.source}_${m.fileId}`)),
    [mods, memberSet],
  );

  // Conflict detection within the selected scheme's member scope
  const { conflictMap } = useConflictDetection(
    mods,
    { modKeys: scheme?.modKeys ?? [], onlyEnabled: true },
  );
  const modTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mods) map[`${m.source}_${m.fileId}`] = m.title;
    return map;
  }, [mods]);

  // Member display mods — overlay scheme's enabled/order on ModInfo
  const displayMods = useMemo(
    () =>
      memberMods.map((m) => {
        const key = `${m.source}_${m.fileId}`;
        return {
          ...m,
          enabled: (scheme?.enabledMods ?? []).includes(key),
          order: scheme?.modOrder?.[key] ?? 0,
        };
      }),
    [memberMods, scheme],
  );

  const modKeyForFileId = useCallback(
    (fileId: number): string | null => {
      const m = mods.find((x) => x.fileId === fileId);
      return m ? `${m.source}_${m.fileId}` : null;
    },
    [mods],
  );

  const handleToggleMember = useCallback(
    (fileId: number, enabled: boolean) => {
      const key = modKeyForFileId(fileId);
      if (!key) return;
      setScheme((prev) => {
        if (!prev) return prev;
        const enabledSet = new Set(prev.enabledMods ?? []);
        if (enabled) enabledSet.add(key);
        else enabledSet.delete(key);
        setDirty(true);
        return { ...prev, enabledMods: [...enabledSet] };
      });
    },
    [modKeyForFileId],
  );

  const handleOrderChange = useCallback((key: string, order: number) => {
    setScheme((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return { ...prev, modOrder: { ...(prev.modOrder ?? {}), [key]: order } };
    });
  }, []);

  const handleRemoveMember = useCallback((key: string) => {
    setScheme((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return removeModsFromScheme(prev, [key]);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!scheme) return;
    try {
      await saveScheme(scheme);
      setDirty(false);
      setLastMessage(`方案 "${scheme.name}" 已保存`);
      void refresh();
    } catch (e) {
      setLastMessage(`保存失败: ${String(e)}`);
    }
  }, [scheme, setLastMessage, refresh]);

  const handleActivate = useCallback(async () => {
    if (!scheme) return;
    const missing = detectMissingMods(scheme, mods);
    if (missing.size > 0) {
      setMissingMods(missing);
      setPendingActivate(scheme);
      return;
    }
    await handleSave();
    onActivate(scheme);
  }, [scheme, mods, handleSave, onActivate]);

  const handleDelete = useCallback(async (name: string) => {
    try {
      await deleteProfile(name);
      if (selectedName === name) setSelectedName(null);
      void refresh();
    } catch (e) {
      setLastMessage(`删除失败: ${String(e)}`);
    }
  }, [selectedName, refresh, setLastMessage, setSelectedName]);

  // ModActionMenu actions
  const handleAddToScheme = useCallback(
    async (targetName: string, keys: string[]) => {
      const target = await loadScheme(targetName);
      if (!target) return;
      const next = addModsToScheme(target, keys, buildModMeta(mods, keys));
      await saveScheme(next);
      setLastMessage(`已加入方案 "${targetName}"`);
      if (targetName === selectedName) setScheme(next);
      void refresh();
    },
    [mods, selectedName, setLastMessage, refresh],
  );

  const handleAddToCollection = useCallback(
    (collectionId: string, keys: string[]) => {
      const changed = useCollectionStore
        .getState()
        .addModsToCollection(collectionId, keys, buildModMeta(mods, keys));
      if (changed) setLastMessage("已加入集合");
    },
    [mods, setLastMessage],
  );

  const contextKeys = useMemo(() => {
    if (!contextMenu) return [];
    return [contextMenu.key];
  }, [contextMenu]);

  const menuMod = useMemo(() => {
    if (!contextMenu) return undefined;
    const m = contextMenu.mod;
    return {
      key: contextMenu.key,
      fileId: m.fileId,
      source: m.source,
      dirPath: m.dirPath,
      enabled: (scheme?.enabledMods ?? []).includes(contextMenu.key),
    };
  }, [contextMenu, scheme]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">方案管理</span>
        <span className="text-xs text-slate-500">成员编辑 · 冲突提示 · 添加 Mod</span>
        <div className="flex-1" />

        {/* Scheme selector dropdown (delete inside) */}
        <ContainerSelect
          placeholder="选择方案..."
          options={profiles.map((p) => ({
            key: p.name,
            label: p.name,
            count: p.modCount,
            meta: activeSchemeName === p.name ? "●" : undefined,
          }))}
          selectedKey={selectedName}
          onSelect={(name) => setSelectedName(name)}
          onDelete={(name) => void handleDelete(name)}
          headerAction={
            <button
              onClick={() => setLastMessage("请使用方案文件的导入/新建功能（待补充）")}
              className="w-full text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700/70 transition-colors"
            >
              + 新建方案
            </button>
          }
        />

        {dirty && (
          <button
            onClick={() => void handleSave()}
            className="text-xs px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
          >
            保存更改
          </button>
        )}
        {scheme && (
          <button
            onClick={() => void handleActivate()}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            激活此方案
          </button>
        )}
        {scheme && (
          <button
            onClick={() => setAddOpen(true)}
            className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
          >
            ＋ 添加 Mod
          </button>
        )}
      </div>

      {/* Member list — reused filter/view/card stack */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!scheme ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-slate-500">从上方选择一个方案查看成员</p>
          </div>
        ) : (
          <MemberModList
            mods={displayMods}
            conflictMap={conflictMap}
            modTitles={modTitles}
            onToggle={(fileId, enabled) => handleToggleMember(fileId, enabled)}
            onOrderChange={handleOrderChange}
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
      {addOpen && scheme && (
        <AddModPanel
          mods={mods}
          existingKeys={memberSet}
          targetLabel={scheme.name}
          onAdd={(keys) => {
            setScheme((prev) => {
              if (!prev) return prev;
              setDirty(true);
              return addModsToScheme(prev, keys, buildModMeta(mods, keys));
            });
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
          schemes={profiles}
          collections={collections}
          containerKind="scheme"
          onToggle={(enabled) => handleToggleMember(contextMenu.mod.fileId, enabled)}
          onAddToScheme={(name) => void handleAddToScheme(name, contextKeys)}
          onAddToCollection={(id) => handleAddToCollection(id, contextKeys)}
          onCreateScheme={() => {
            setLastMessage("请到方案列表创建新方案（导入/新建入口待补充）");
          }}
          onCreateCollection={() => {
            setLastMessage("请到集合页新建集合");
          }}
          onRemoveFromContainer={() => handleRemoveMember(contextMenu.key)}
          onOrderUp={() => handleOrderChange(contextMenu.key, (scheme?.modOrder?.[contextMenu.key] ?? 0) + 1)}
          onOrderDown={() => handleOrderChange(contextMenu.key, Math.max(0, (scheme?.modOrder?.[contextMenu.key] ?? 0) - 1))}
        />
      )}

      {missingMods && (
        <MissingModsDialog
          missing={missingMods}
          onClose={() => {
            setMissingMods(null);
            if (pendingActivate) {
              void handleSave();
              onActivate(pendingActivate);
              setPendingActivate(null);
            }
          }}
        />
      )}
    </div>
  );
}

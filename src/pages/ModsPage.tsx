import { useCallback, useEffect, useState } from "react";
import type { ModInfo, ProfileMeta } from "../lib/types";
import ModList from "../components/ModList/ModList";
import SettingsEditor from "../components/SettingsEditor/SettingsEditor";
import { useModStore } from "../store/useModStore";
import { useAppStore } from "../store/useAppStore";
import { useCollectionStore } from "../store/useCollectionStore";
import { listProfiles } from "../lib/tauriApi";
import { loadScheme, addModsToScheme, saveScheme, buildModMeta, buildModSettings } from "../utils/schemeMembers";
import { createLogger } from "../lib/logger";

interface Props {
  mods: ModInfo[];
  saving: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onSelectMod: (key: string) => void;
  onSaveSelectionAsCollection: () => void;
  onSettingsSaved: (key: string, settings: Record<string, unknown>) => void;
}

const log = createLogger("ModsPage");

/** All-read mods page — global pool browse/filter/organize + join operations. */
export default function ModsPage({
  mods,
  saving,
  refreshing,
  onRefresh,
  onSelectMod,
  onSaveSelectionAsCollection,
  onSettingsSaved,
}: Props) {
  const selectedModKey = useModStore((s) => s.selectedModKey);
  const selectMod = useModStore((s) => s.selectMod);
  const updateModSettings = useModStore((s) => s.updateModSettings);
  const addDirtyModSetting = useAppStore((s) => s.addDirtyModSetting);
  const setDirty = useAppStore((s) => s.setDirty);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const collections = useCollectionStore((s) => s.collections);
  const addModsToCollection = useCollectionStore((s) => s.addModsToCollection);

  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);

  const refreshProfiles = useCallback(async () => {
    try {
      setProfiles(await listProfiles());
    } catch (e) {
      log.error(`listProfiles failed: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshProfiles();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshProfiles]);

  const selectedMod = selectedModKey ? mods.find((m) => `${m.source}_${m.fileId}` === selectedModKey) ?? null : null;

  const handleAddToScheme = useCallback(
    async (schemeName: string, keys: string[]) => {
      const target = await loadScheme(schemeName);
      if (!target) return;
      // ★ v3: carry the read-mods (base) config snapshot into the scheme
      const next = addModsToScheme(
        target,
        keys,
        buildModMeta(mods, keys),
        buildModSettings(mods, keys),
      );
      await saveScheme(next);
      setLastMessage(`已加入方案 "${schemeName}"`);
      void refreshProfiles();
    },
    [mods, refreshProfiles, setLastMessage],
  );

  const handleAddToCollection = useCallback(
    (collectionId: string, keys: string[]) => {
      // ★ v3: carry the read-mods (base) config snapshot into the collection
      const changed = addModsToCollection(
        collectionId,
        keys,
        buildModMeta(mods, keys),
        buildModSettings(mods, keys),
      );
      if (changed) setLastMessage("已加入集合");
    },
    [mods, addModsToCollection, setLastMessage],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">已读取 Mod</span>
        <span className="text-xs text-slate-500">
          共 {mods.length} 个 · 启动器读取到的全部 Mod
        </span>
        <div className="flex-1" />
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                       text-slate-400 rounded transition-colors cursor-pointer shrink-0
                       disabled:opacity-50"
          >
            {refreshing ? "刷新中..." : "刷新"}
          </button>
        )}
      </div>

      <div className={`flex-1 flex flex-col overflow-hidden ${selectedMod ? "hidden" : ""}`}>
        <ModList
          saving={saving}
          onSelectMod={onSelectMod}
          onSaveSelectionAsCollection={onSaveSelectionAsCollection}
          readOnly
          modMenu={{
            schemes: profiles,
            collections,
            onAddToScheme: (name, keys) => void handleAddToScheme(name, keys),
            onAddToCollection: (id, keys) => handleAddToCollection(id, keys),
            onCreateScheme: () => setLastMessage("请到方案页创建新方案"),
            onCreateCollection: () => setLastMessage("请到集合页新建集合"),
          }}
        />
      </div>

      {selectedMod && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <SettingsEditor
            mod={selectedMod}
            onClose={() => selectMod(null)}
            onSettingsSaved={(settings) => {
              updateModSettings(selectedModKey!, settings);
              addDirtyModSetting(selectedModKey!);
              setDirty(true);
              onSettingsSaved(selectedModKey!, settings);
            }}
          />
        </div>
      )}
    </div>
  );
}

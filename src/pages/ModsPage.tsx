import type { ModInfo } from "../lib/types";
import ModList from "../components/ModList/ModList";
import SettingsEditor from "../components/SettingsEditor/SettingsEditor";
import { useModStore } from "../store/useModStore";
import { useAppStore } from "../store/useAppStore";

interface Props {
  mods: ModInfo[];
  saving: boolean;
  onSelectMod: (key: string) => void;
  onSaveSelectionAsCollection: () => void;
  onSettingsSaved: (key: string, settings: Record<string, unknown>) => void;
}

/** All-read mods page — global pool browse/filter/organize + join operations. */
export default function ModsPage({
  mods,
  saving,
  onSelectMod,
  onSaveSelectionAsCollection,
  onSettingsSaved,
}: Props) {
  const selectedModKey = useModStore((s) => s.selectedModKey);
  const selectMod = useModStore((s) => s.selectMod);
  const updateModSettings = useModStore((s) => s.updateModSettings);
  const addDirtyModSetting = useAppStore((s) => s.addDirtyModSetting);
  const setDirty = useAppStore((s) => s.setDirty);

  const selectedMod = selectedModKey ? mods.find((m) => `${m.source}_${m.fileId}` === selectedModKey) ?? null : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">已读取 Mod</span>
        <span className="text-xs text-slate-500">
          共 {mods.length} 个 · 启动器读取到的全部 Mod
        </span>
      </div>

      <div className={`flex-1 flex flex-col overflow-hidden ${selectedMod ? "hidden" : ""}`}>
        <ModList
          saving={saving}
          onSelectMod={onSelectMod}
          onSaveSelectionAsCollection={onSaveSelectionAsCollection}
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

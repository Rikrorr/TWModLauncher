import type { ModInfo, ModMeta } from "../lib/types";
import CollectionPanel from "../components/Collection/CollectionPanel";

interface Props {
  mods: ModInfo[];
  onCreateSchemeFromCollection: (collectionId: string) => void;
  /** Cross-page creation seed (from ModsPage multi-select → save as collection). */
  seed?: { modKeys: string[]; modMeta: Record<string, ModMeta> } | null;
  onSeedConsumed?: () => void;
}

/** Collection management page — offline bundle lifecycle + member editing. */
export default function CollectionsPage({ mods, onCreateSchemeFromCollection, seed, onSeedConsumed }: Props) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">集合管理</span>
        <span className="text-xs text-slate-500">离线分组包 · 新方案的模板</span>
      </div>
      <CollectionPanel
        mods={mods}
        onClose={() => onSeedConsumed?.()}
        onCreateSchemeFromCollection={onCreateSchemeFromCollection}
        seed={seed}
      />
    </div>
  );
}

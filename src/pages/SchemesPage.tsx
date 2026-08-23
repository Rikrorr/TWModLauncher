import { useState } from "react";
import type { ModInfo, ProfileData } from "../lib/types";
import SchemeSelector from "../components/ProfileManager/SchemeSelector";
import ProfileManager from "../components/ProfileManager/ProfileManager";

interface Props {
  gamePath: string;
  mods: ModInfo[];
  onActivate: (data: ProfileData) => void;
  /** Passed through to the inner manager's controlled open (from other pages). */
  openRequest?: boolean;
  onOpenRequestHandled?: () => void;
}

/** Scheme management page — scheme lifecycle + member editing. */
export default function SchemesPage({
  gamePath,
  mods,
  onActivate,
  openRequest,
  onOpenRequestHandled,
}: Props) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [createSignal, setCreateSignal] = useState<{ name: string } | null>(null);

  // Handle external "open manager" request (e.g. from launch page quick action)
  const effectiveOpen = openRequest ?? managerOpen;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">方案管理</span>
        <span className="text-xs text-slate-500">定义与切换启动方案</span>
        <div className="flex-1" />
        <SchemeSelector
          mods={mods}
          onActivate={onActivate}
          onOpenManager={() => {
            setCreateSignal(null);
            setManagerOpen(true);
          }}
          onCreateScheme={() => {
            setCreateSignal({ name: "" });
            setManagerOpen(true);
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <ProfileManager
          gamePath={gamePath}
          mods={mods}
          onLoad={onActivate}
          open={effectiveOpen}
          onOpenChange={(v) => {
            setManagerOpen(v);
            onOpenRequestHandled?.();
          }}
          createSignal={createSignal}
        />
      </div>
    </div>
  );
}

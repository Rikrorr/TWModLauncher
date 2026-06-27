import type { ModMeta } from "../../lib/types";
import { openSteamWorkshop, openWorkshopUrl } from "../../lib/tauriApi";

interface Props {
  /** Map of modKey -> ModMeta for mods missing from the current installation */
  missing: Map<string, ModMeta>;
  onClose: () => void;
}

export default function MissingModsDialog({ missing, onClose }: Props) {
  const missingList = [...missing.entries()];
  const workshopMods = missingList.filter(([, m]) => m.source === 1);
  const localMods = missingList.filter(([, m]) => m.source === 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[480px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-200">
            缺失 Mod 列表
          </h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 cursor-pointer transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3 text-xs">
          <p className="text-slate-400">
            当前客户端缺少 {missingList.length} 个方案中引用的 Mod：
          </p>

          {workshopMods.length > 0 && (
            <div>
              <p className="text-slate-500 mb-1.5">
                工坊 Mod（{workshopMods.length} 个）：
              </p>
              <div className="space-y-1.5">
                {workshopMods.map(([key, meta]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between bg-slate-700/50 rounded px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-200 truncate" title={meta.title}>
                        {meta.title}
                      </p>
                      <p className="text-slate-500 text-[10px] truncate">
                        {meta.author}
                        {meta.version ? ` · v${meta.version}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 ml-3 relative group inline-flex items-center">
                      <span className="text-[11px] px-2.5 py-1 bg-blue-600 text-white rounded cursor-default group-hover:invisible">
                        访问
                      </span>
                      <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap bg-blue-600 rounded px-2.5 py-1">
                        <button
                          onClick={() => openWorkshopUrl(meta.fileId).catch(() => {})}
                          className="text-[11px] text-blue-200 hover:text-white cursor-pointer transition-colors"
                        >
                          浏览器
                        </button>
                        <span className="text-blue-700">·</span>
                        <button
                          onClick={() => openSteamWorkshop(meta.fileId).catch(() => {})}
                          className="text-[11px] text-blue-200 hover:text-white cursor-pointer transition-colors"
                        >
                          创意工坊
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localMods.length > 0 && (
            <div>
              <p className="text-slate-500 mb-1.5">
                本地 Mod（{localMods.length} 个）：
              </p>
              <div className="space-y-1.5">
                {localMods.map(([key, meta]) => (
                  <div
                    key={key}
                    className="bg-slate-700/50 rounded px-3 py-2"
                  >
                    <p className="text-slate-200 truncate" title={meta.title}>
                      {meta.title}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      此 Mod 为本地 Mod，请手动复制安装
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 bg-slate-600 hover:bg-slate-500
                       text-white rounded cursor-pointer transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

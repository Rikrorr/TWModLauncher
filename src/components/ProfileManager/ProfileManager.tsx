import { useEffect, useState } from "react";
import { save, open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  listProfiles,
  saveProfile,
  loadProfile,
  deleteProfile,
  writeFile,
  readFile,
} from "../../lib/tauriApi";
import { useAppStore } from "../../store/useAppStore";
import type { ModInfo, ModMeta, ProfileData, ProfileMeta } from "../../lib/types";
import MissingModsDialog from "./MissingModsDialog";
import { createLogger } from "../../lib/logger";

interface Props {
  gamePath: string;
  mods: ModInfo[];
  onLoad: (data: ProfileData) => void;
}

/** Compare a profile's referenced mod keys against the currently installed mods.
 *  Returns a Map of missing mod keys -> ModMeta (only for mods that have metadata). */
function detectMissingMods(data: ProfileData, mods: ModInfo[]): Map<string, ModMeta> {
  const installedKeys = new Set(
    mods.map((m) => `${m.source}_${m.fileId}`)
  );
  const referencedKeys = new Set<string>();
  data.enabledMods.forEach((k) => referencedKeys.add(k));
  Object.keys(data.modOrder ?? {}).forEach((k) => referencedKeys.add(k));
  Object.keys(data.modSettings ?? {}).forEach((k) => referencedKeys.add(k));
  (data.groups ?? []).forEach((g) => g.modKeys.forEach((k) => referencedKeys.add(k)));

  const missing = new Map<string, ModMeta>();
  for (const key of referencedKeys) {
    if (!installedKeys.has(key) && data.modMeta?.[key]) {
      missing.set(key, data.modMeta[key]);
    }
  }
  return missing;
}

const log = createLogger("ProfileManager");

export default function ProfileManager({ gamePath, mods, onLoad }: Props) {
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const [confirmOverwriteName, setConfirmOverwriteName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "info" | "ok" | "error" } | null>(null);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingLoad, setPendingLoad] = useState<ProfileData | null>(null);

  const refresh = async () => {
    try {
      const list = await listProfiles();
      setProfiles(list);
    } catch (e) {
      log.error(`refresh error: ${String(e)}`);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const flash = (msg: string, ms = 3000) => {
    setMessage({ text: msg, type: "info" });
    setTimeout(() => setMessage(null), ms);
  };

  const flashOk = (msg: string) => {
    setMessage({ text: msg, type: "ok" });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSave = async (forceOverwrite = false) => {
    const name = saveName.trim();
    if (!name) return;

    if (!forceOverwrite) {
      const existing = profiles.find((p) => p.name === name);
      if (existing) {
        setConfirmOverwriteName(name);
        return;
      }
    }

    const appStore = useAppStore.getState();
    const data: ProfileData = {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      gamePath,
      enabledMods: mods
        .filter((m) => m.enabled)
        .map((m) => `${m.source}_${m.fileId}`),
      modOrder: Object.fromEntries(
        mods.filter((m) => m.order > 0).map((m) => [`${m.source}_${m.fileId}`, m.order])
      ),
      modSettings: Object.fromEntries(
        mods
          .filter((m) => Object.keys(m.currentSettings).length > 0)
          .map((m) => [`${m.source}_${m.fileId}`, m.currentSettings])
      ),
      groups: appStore.groups,
      groupOrder: appStore.groupOrder,
      modMeta: Object.fromEntries(
        mods.map((m) => {
          const key = `${m.source}_${m.fileId}`;
          const meta: ModMeta = {
            title: m.title,
            author: m.author,
            source: m.source,
            fileId: m.fileId,
          };
          if (m.version) meta.version = m.version;
          return [key, meta];
        })
      ),
    };
    try {
      await saveProfile(name, JSON.stringify(data, null, 2));
      flash(forceOverwrite ? `方案 "${name}" 已覆盖` : `方案 "${name}" 已新建`);
      setSaveName("");
      setShowSave(false);
      setConfirmOverwriteName(null);
      refresh();
    } catch (e) {
      flash(`保存失败: ${String(e)}`);
    }
  };

  const handleLoad = async (name: string) => {
    try {
      const raw = await loadProfile(name);
      const data = JSON.parse(raw) as ProfileData;

      const missing = detectMissingMods(data, mods);
      if (missing.size > 0) {
        setOpen(false);
        setPendingLoad(data);
        setMissingMods(missing);
        return;
      }

      onLoad(data);
      flash(`方案 "${name}" 已加载`);
      setOpen(false);
    } catch (e) {
      flash(`加载失败: ${String(e)}`);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteProfile(name);
      flash(`方案 "${name}" 已删除`);
      refresh();
    } catch (e) {
      flash(`删除失败: ${String(e)}`);
    }
  };

  const handleExport = async (name: string) => {
    try {
      const raw = await loadProfile(name);
      const path = await save({
        defaultPath: `${name}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeFile(path, raw);
      flash(`方案 "${name}" 已导出`);
    } catch (e) {
      flash(`导出失败: ${String(e)}`);
    }
  };

  const handleImport = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected) return;
      const path = selected as string;
      const raw = await readFile(path);
      const data = JSON.parse(raw) as ProfileData;
      if (!data.name || !Array.isArray(data.enabledMods)) {
        flash("导入失败: 无效的方案文件");
        return;
      }

      // Save to local store first
      await saveProfile(data.name, JSON.stringify(data, null, 2));
      refresh();

      const missing = detectMissingMods(data, mods);
      if (missing.size > 0) {
        setOpen(false);
        setMissingMods(missing);
      } else {
        flashOk(`方案 "${data.name}" 已导入`);
      }
    } catch (e) {
      flash(`导入失败: ${String(e)}`);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs px-3 py-1 border border-slate-600 hover:border-slate-400
                   text-slate-400 rounded transition-colors cursor-pointer shrink-0"
      >
        方案管理
      </button>

      {message && (
        <div className={`fixed top-14 left-1/2 -translate-x-1/2 z-[100]
                        px-4 py-1.5 text-sm rounded shadow-lg ${
          message.type === "ok"
            ? "bg-green-700 text-green-100"
            : message.type === "error"
              ? "bg-red-700 text-red-100"
              : "bg-slate-700 text-slate-200"
        }`}>
          {message.text}
        </div>
      )}

      {missingMods && (
        <MissingModsDialog
          missing={missingMods}
          onClose={() => {
            const count = missingMods.size;
            setMissingMods(null);
            if (pendingLoad) {
              onLoad(pendingLoad);
              setPendingLoad(null);
              flashOk(`方案 "${pendingLoad.name}" 已加载（${count} 个 Mod 缺失）`);
            } else {
              flashOk(`方案已导入（${count} 个 Mod 缺失）`);
            }
          }}
        />
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-slate-800 border border-slate-600
                        rounded-lg shadow-xl z-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Mod方案</span>
            <div className="flex items-center gap-1">
              <button
                onClick={handleImport}
                title="从 JSON 文件导入方案"
                className="text-xs px-2 py-0.5 border border-slate-600
                           text-slate-400 hover:text-slate-200 hover:border-slate-400
                           rounded cursor-pointer transition-colors"
              >
                导入
              </button>
              {!showSave ? (
                <button
                  onClick={() => setShowSave(true)}
                  className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-500
                             text-white rounded cursor-pointer"
                >
                  + 新建
                </button>
              ) : (
                <button
                  onClick={() => { setShowSave(false); setSaveName(""); setConfirmOverwriteName(null); }}
                  className="text-xs px-2 py-0.5 text-slate-400
                             hover:text-slate-200 cursor-pointer"
                >
                  取消
                </button>
              )}
            </div>
          </div>

          {showSave && (
            <div className="mb-2 space-y-1.5">
              <div className="flex gap-1">
                <input
                  value={saveName}
                  onChange={(e) => { setSaveName(e.target.value); setConfirmOverwriteName(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="方案名称..."
                  className="flex-1 text-xs px-2 py-1 bg-slate-700 border border-slate-600
                             rounded text-slate-200 outline-none"
                  autoFocus
                />
                {!confirmOverwriteName && (
                  <button
                    onClick={() => handleSave()}
                    disabled={!saveName.trim()}
                    className="text-xs px-2 py-0.5 bg-green-600 hover:bg-green-500
                               disabled:bg-green-800 text-white rounded cursor-pointer"
                  >
                    新建
                  </button>
                )}
              </div>
              {confirmOverwriteName && (
                <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-700/50
                                rounded px-2 py-1.5">
                  <span className="text-xs text-amber-300 flex-1">
                    方案 "{confirmOverwriteName}" 已存在，是否覆盖？
                  </span>
                  <button
                    onClick={() => handleSave(true)}
                    className="text-xs px-2 py-0.5 bg-amber-600 hover:bg-amber-500
                               text-white rounded cursor-pointer"
                  >
                    覆盖
                  </button>
                  <button
                    onClick={() => setConfirmOverwriteName(null)}
                    className="text-xs px-2 py-0.5 border border-slate-500
                               text-slate-300 hover:text-slate-100 rounded cursor-pointer"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="max-h-48 overflow-y-auto">
            {profiles.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">
                暂无保存的方案
              </p>
            ) : (
              profiles.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center justify-between py-1.5
                             hover:bg-slate-700/50 rounded px-1"
                >
                  <span className="text-xs text-slate-300">{p.name}</span>
                  <span className="text-xs text-slate-500">
                    {p.modCount} Mod
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleLoad(p.name)}
                      className="text-xs px-1.5 py-0.5 bg-blue-600 hover:bg-blue-500
                                 text-white rounded cursor-pointer"
                    >
                      加载
                    </button>
                    <button
                      onClick={() => handleExport(p.name)}
                      title="导出为 JSON 文件"
                      className="text-xs px-1.5 py-0.5 border border-slate-500
                                 text-slate-400 hover:text-slate-200
                                 rounded cursor-pointer transition-colors"
                    >
                      导出
                    </button>
                    <button
                      onClick={() => handleDelete(p.name)}
                      className="text-xs px-1.5 py-0.5 bg-red-600 hover:bg-red-500
                                 text-white rounded cursor-pointer"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

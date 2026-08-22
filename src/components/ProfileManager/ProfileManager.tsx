import { useEffect, useState } from "react";
import { save, open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import {
  listProfiles,
  saveProfile,
  loadProfile,
  deleteProfile,
  writeFile,
  readFile,
} from "../../lib/tauriApi";
import { useAppStore } from "../../store/useAppStore";
import { useCategoryStore } from "../../store/useCategoryStore";
import { useNoteStore } from "../../store/useNoteStore";
import type { ModInfo, ModMeta, ProfileData, ProfileDataV1, ProfileMeta } from "../../lib/types";
import MissingModsDialog from "./MissingModsDialog";
import { createLogger } from "../../lib/logger";
import { detectMissingMods, isProfileV2, migrateProfileV1 } from "../../utils/migrateProfile";

interface Props {
  gamePath: string;
  mods: ModInfo[];
  onLoad: (data: ProfileData) => void;
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
  const activeSchemeName = useAppStore((s) => s.activeSchemeName);

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
    let name = saveName.trim();
    if (!name) {
      // Generate default name that doesn't conflict
      const base = "新建方案";
      name = base;
      for (let i = 2; profiles.some((p) => p.name === name); i++) {
        name = `${base} ${i}`;
      }
    }

    if (!forceOverwrite) {
      const existing = profiles.find((p) => p.name === name);
      if (existing) {
        setConfirmOverwriteName(name);
        return;
      }
    }

    const appStore = useAppStore.getState();
    const catStore = useCategoryStore.getState();
    const noteStore = useNoteStore.getState();
    const allKeys = mods.map((m) => `${m.source}_${m.fileId}`);
    // v2 member whitelist: union of enabled + ordered + configured + grouped mods
    const modKeys = [...new Set([
      ...mods.filter((m) => m.enabled).map((m) => `${m.source}_${m.fileId}`),
      ...mods.filter((m) => m.order > 0).map((m) => `${m.source}_${m.fileId}`),
      ...mods.filter((m) => Object.keys(m.currentSettings).length > 0).map((m) => `${m.source}_${m.fileId}`),
      ...appStore.groups.flatMap((g) => g.modKeys),
    ])];
    const data: ProfileData = {
      version: 2,
      name,
      createdAt: new Date().toISOString(),
      gamePath,
      modKeys,
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
      displayOrder: (() => {
        try {
          const raw = localStorage.getItem("twm-filter-prefs");
          if (raw) return JSON.parse(raw).displayOrder ?? [];
        } catch { /* ignore */ }
        return [];
      })(),
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
      // ★ v2: carry global categories/notes into the scheme for propagation
      modCategories: Object.fromEntries(
        allKeys
          .filter((k) => (catStore.modCats[k] ?? []).length > 0)
          .map((k) => [k, catStore.modCats[k]]),
      ),
      modNotes: Object.fromEntries(
        allKeys
          .filter((k) => noteStore.notes[k]?.trim())
          .map((k) => [k, noteStore.notes[k].trim()]),
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

      let parsed: ProfileData | ProfileDataV1;
      try {
        parsed = JSON.parse(raw);
      } catch {
        flash("方案文件已损坏，无法加载");
        return;
      }

      // Migrate v1 → v2 on load (in-memory only; saved back on next save).
      // Back up the original v1 file first (migration is irreversible).
      const data: ProfileData = isProfileV2(parsed)
        ? (parsed as ProfileData)
        : (() => {
            saveProfile(`${name}.bak-v1`, raw).catch(() => {});
            return migrateProfileV1(parsed as ProfileDataV1);
          })();

      const missing = detectMissingMods(data, mods);
      if (missing.size > 0) {
        setOpen(false);
        setPendingLoad(data);
        setMissingMods(missing);
        return;
      }

      onLoad(data);
      useAppStore.getState().setActiveSchemeName(data.name);
      flash(`方案 "${name}" 已加载`);
      setOpen(false);
    } catch (e) {
      flash(`加载失败: ${String(e)}`);
    }
  };

  const handleDelete = async (name: string) => {
    const confirmed = await ask(
      `确定要删除方案 "${name}" 吗？此操作不可撤销。`,
      { title: "确认删除", kind: "warning" },
    );
    if (!confirmed) return;
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
      // Privacy prompt: warn when the scheme carries user notes/categories
      try {
        const data = JSON.parse(raw);
        const hasUserData =
          (data.modNotes && Object.keys(data.modNotes).length > 0) ||
          (data.modCategories && Object.keys(data.modCategories).length > 0);
        if (hasUserData) {
          const noteCount = Object.keys(data.modNotes ?? {}).length;
          const catCount = Object.keys(data.modCategories ?? {}).length;
          const ok = await ask(
            `该方案包含 ${noteCount} 条备注与 ${catCount} 个 Mod 的分类信息。备注可能包含个人记录，导出/分享前请检查内容。`,
            { title: "隐私提示", kind: "warning" },
          );
          if (!ok) return;
        }
      } catch { /* ignore — non-JSON handled below */ }

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

      let data: ProfileData | ProfileDataV1;
      try {
        data = JSON.parse(raw);
      } catch {
        flash("导入失败: 文件格式无效，请确认选择的是 JSON 方案文件");
        return;
      }

      if (!data.name || !Array.isArray(data.enabledMods)) {
        flash("导入失败: 无效的方案文件");
        return;
      }

      // Version compatibility check (v2 supported; v1 auto-migrated)
      if (data.version !== undefined && data.version > 2) {
        flash(
          `导入失败: 方案版本不兼容（文件版本 ${data.version}，当前支持版本 2）`,
        );
        return;
      }
      const migrated: ProfileData = isProfileV2(data) ? data : migrateProfileV1(data);

      // Check for overwrite
      const existing = profiles.find((p) => p.name === migrated.name);
      if (existing) {
        const confirmed = await ask(
          `方案 "${migrated.name}" 已存在，是否覆盖？`,
          { title: "确认覆盖", kind: "warning" },
        );
        if (!confirmed) return;
      }

      // Save to local store (as v2)
      await saveProfile(migrated.name, JSON.stringify(migrated, null, 2));
      refresh();

      const missing = detectMissingMods(migrated, mods);
      if (missing.size > 0) {
        setOpen(false);
        setMissingMods(missing);
      } else {
        flashOk(`方案 "${migrated.name}" 已导入`);
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
                    className="text-xs px-2 py-0.5 bg-green-600 hover:bg-green-500
                               text-white rounded cursor-pointer"
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
              profiles.map((p) => {
                const isActive = activeSchemeName === p.name;
                return (
                <div
                  key={p.name}
                  className={`flex items-center justify-between py-1.5
                             hover:bg-slate-700/50 rounded px-1 ${
                               isActive ? "bg-blue-900/40 border border-blue-700/50" : ""
                             }`}
                >
                  <span className={`text-xs ${isActive ? "text-blue-300" : "text-slate-300"}`}>
                    {isActive ? "● " : ""}{p.name}
                  </span>
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
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

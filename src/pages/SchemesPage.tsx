import { useCallback, useEffect, useMemo, useState } from "react";
import { ask, save, open as openDialog } from "@tauri-apps/plugin-dialog";
import { listProfiles, deleteProfile, saveProfile, writeFile, readFile } from "../lib/tauriApi";
import { useAppStore } from "../store/useAppStore";
import { useCollectionStore } from "../store/useCollectionStore";
import {
  loadScheme,
  saveScheme,
  addModsToScheme,
  removeModsFromScheme,
  buildModMeta,
  buildModSettings,
  analyzeCollectionMerge,
  mergeCollectionIntoScheme,
  ensureLoadOrder,
  reorderDisabledToEnd,
  sanitizeSchemeName,
  dateDefaultName,
  type CollectionMergeConflict,
} from "../utils/schemeMembers";
import { detectMissingMods, isProfileV2, migrateProfileV1 } from "../utils/migrateProfile";
import type { ModGroup, ModInfo, ModMeta, ModCollection, ProfileData, ProfileDataV1, ProfileMeta } from "../lib/types";
import ModActionMenu from "../components/common/ModActionMenu";
import AddModPanel from "../components/common/AddModPanel";
import ContainerSelect from "../components/common/ContainerSelect";
import CreateDialog from "../components/common/CreateDialog";
import RenameDialog from "../components/common/RenameDialog";
import ModList from "../components/ModList/ModList";
import LoadOrderList from "../components/Scheme/LoadOrderList";
import SettingsEditor from "../components/SettingsEditor/SettingsEditor";
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
  // ★ v2.1: scheme display mode — observation (groups) vs load order (flat)
  const [orderView, setOrderView] = useState<"observation" | "load">("observation");
  const [addOpen, setAddOpen] = useState(false);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingActivate, setPendingActivate] = useState<ProfileData | null>(null);
  // ★ v2.1: missing-mod warning after importing a scheme (separate from activation)
  const [importMissingMods, setImportMissingMods] = useState<Map<string, ModMeta> | null>(null);
  // ★ v2.1: rename target (old scheme name) for the rename dialog
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; key: string; mod: ModInfo;
  } | null>(null);
  // ★ v3: per-scheme mod config editor (snapshot, not written to disk directly)
  const [configModKey, setConfigModKey] = useState<string | null>(null);
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
        setConfigModKey(null);
      }
    });
    return () => { cancelled = true; };
  }, [selectedName]);

  const memberSet = useMemo(() => new Set(scheme?.modKeys ?? []), [scheme]);
  const memberMods = useMemo(
    () => mods.filter((m) => memberSet.has(`${m.source}_${m.fileId}`)),
    [mods, memberSet],
  );

  // ★ v2.1: effective member load sequence (migrates legacy schemes on first use)
  const effectiveLoadOrder = useMemo(() => (scheme ? ensureLoadOrder(scheme) : []), [scheme]);
  const loadPosMap = useMemo(() => {
    const map = new Map<string, number>();
    // ★ v2.1: 0-based load order positions (game write stays 1..N)
    effectiveLoadOrder.forEach((k, i) => map.set(k, i));
    return map;
  }, [effectiveLoadOrder]);

  // Member display mods — overlay scheme's enabled/order on ModInfo
  const displayMods = useMemo(
    () =>
      memberMods.map((m) => {
        const key = `${m.source}_${m.fileId}`;
        return {
          ...m,
          enabled: (scheme?.enabledMods ?? []).includes(key),
          // ★ v2.1: derived order = position in the load sequence (legacy modOrder no longer edited)
          order: loadPosMap.get(key) ?? 0,
          // ★ v3: show the scheme's settings snapshot (falls back to read-mods base)
          currentSettings:
            (scheme?.modSettings?.[key] && Object.keys(scheme.modSettings[key]).length > 0)
              ? scheme.modSettings[key]
              : m.currentSettings,
        };
      }),
    [memberMods, scheme, loadPosMap],
  );

  // Members rendered in load sequence (for the load-order view)
  const loadMods = useMemo(() => {
    const byKey = new Map(displayMods.map((m) => [`${m.source}_${m.fileId}`, m]));
    return effectiveLoadOrder
      .map((k) => byKey.get(k))
      .filter((m): m is ModInfo => m !== undefined);
  }, [displayMods, effectiveLoadOrder]);

  // ★ v3: effective displayOrder — ensure every member key is present so
  // drag-to-reorder works even for schemes created before displayOrder was tracked.
  const effectiveDisplayOrder = useMemo(() => {
    const base = scheme?.displayOrder ?? [];
    const order = base.filter((k) => {
      const isGroup = (scheme?.groups ?? []).some((g) => g.id === k);
      const isMember = (scheme?.modKeys ?? []).includes(k);
      return isGroup || isMember;
    });
    for (const mk of scheme?.modKeys ?? []) {
      if (!order.includes(mk)) order.push(mk);
    }
    return order;
  }, [scheme]);

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
        const enabledMods = [...enabledSet];
        // ★ v2.1: disabled mods drop to the end of the load order, enabled shift up
        const loadOrder = reorderDisabledToEnd(ensureLoadOrder(prev), enabledMods);
        const next = { ...prev, enabledMods, loadOrder };
        void saveScheme(next).catch(() => {});
        return next;
      });
    },
    [modKeyForFileId],
  );

  // ★ v2.1: order mutations reposition the member within the load sequence.
  // Input N = move to 0-based position N — the mod at N and below shift +1.
  const handleOrderChange = useCallback((key: string, order: number) => {
    setScheme((prev) => {
      if (!prev) return prev;
      const cur = ensureLoadOrder(prev);
      const from = cur.indexOf(key);
      if (from === -1) return prev;
      const target = Math.max(0, Math.min(cur.length - 1, Math.round(order)));
      if (target === from) return prev;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(target, 0, key);
      const out = { ...prev, loadOrder: next };
      void saveScheme(out).catch(() => {});
      return out;
    });
  }, []);

  // ★ v2.1: move a member one slot up/down in the load sequence
  const handleLoadMove = useCallback((key: string, delta: -1 | 1) => {
    setScheme((prev) => {
      if (!prev) return prev;
      const cur = ensureLoadOrder(prev);
      const from = cur.indexOf(key);
      if (from === -1) return prev;
      const to = Math.max(0, Math.min(cur.length - 1, from + delta));
      if (to === from) return prev;
      const next = [...cur];
      next.splice(from, 1);
      next.splice(to, 0, key);
      const out = { ...prev, loadOrder: next };
      void saveScheme(out).catch(() => {});
      return out;
    });
  }, []);

  // ★ v2.1: remove one or more members (multi-select context menu)
  const handleRemoveMembers = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setScheme((prev) => {
      if (!prev) return prev;
      const next = removeModsFromScheme(prev, keys);
      void saveScheme(next).catch(() => {});
      return next;
    });
    clearSelection();
    // ★ v2.1: refresh the dropdown count after removing members
    void refresh();
  }, [clearSelection, refresh]);

  // ★ v3: containerized groups / displayOrder (bound to the scheme data)
  // ★ v2.1: accept value-or-updater so sequential multi-key updates compose
  const handleGroupsChange = useCallback((groups: ModGroup[] | ((prev: ModGroup[]) => ModGroup[])) => {
    setScheme((prev) => {
      if (!prev) return prev;
      const nextGroups = typeof groups === "function" ? groups(prev.groups ?? []) : groups;
      const next = { ...prev, groups: nextGroups };
      void saveScheme(next).catch(() => {});
      return next;
    });
  }, []);

  const handleDisplayOrderChange = useCallback((displayOrder: string[] | ((prev: string[]) => string[])) => {
    setScheme((prev) => {
      if (!prev) return prev;
      const nextOrder = typeof displayOrder === "function" ? displayOrder(prev.displayOrder ?? []) : displayOrder;
      const next = { ...prev, displayOrder: nextOrder };
      void saveScheme(next).catch(() => {});
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!scheme) return;
    try {
      await saveScheme(scheme);
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
      // ★ v2.1: deleting the active scheme clears the active-scheme state
      if (useAppStore.getState().activeSchemeName === name) {
        useAppStore.getState().setActiveSchemeName(null);
        useAppStore.getState().setActiveSchemeModKeys(null);
      }
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
      const next = addModsToScheme(
        target,
        keys,
        buildModMeta(mods, keys),
        buildModSettings(mods, keys),
      );
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
        .addModsToCollection(
          collectionId,
          keys,
          buildModMeta(mods, keys),
          buildModSettings(mods, keys),
        );
      if (changed) setLastMessage("已加入集合");
    },
    [mods, setLastMessage],
  );

  // ★ v3: create a new (empty) scheme via modal dialog
  const [createSchemeOpen, setCreateSchemeOpen] = useState(false);
  const handleCreateScheme = useCallback(
    async (rawName: string) => {
      // ★ v2.1: scheme names become file names — strip Windows-invalid chars,
      // and ask the user before silently rewriting their input.
      const name = sanitizeSchemeName(rawName);
      if (!name) {
        setLastMessage("方案名称无效（仅含文件名非法字符）");
        return;
      }
      if (name !== rawName.trim()) {
        const ok = await ask(
          `名称 "${rawName}" 包含文件名非法字符（如 / \\ : * ? " < > |），将以 "${name}" 创建。是否继续？`,
          { title: "名称含非法字符", kind: "warning" },
        );
        if (!ok) return;
      }
      const now = new Date().toISOString();
      const data: ProfileData = {
        version: 2,
        name,
        createdAt: now,
        gamePath: useAppStore.getState().gamePath ?? "",
        modKeys: [],
        enabledMods: [],
        modOrder: {},
        modSettings: {},
        groups: [],
        displayOrder: [],
        modMeta: {},
      };
      try {
        await saveProfile(name, JSON.stringify(data, null, 2));
        setSelectedName(name);
        setLastMessage(
          name !== rawName.trim()
            ? `方案 "${name}" 已创建（已移除文件名非法字符）`
            : `方案 "${name}" 已创建`,
        );
        void refresh();
      } catch (e) {
        setLastMessage(`创建失败: ${String(e)}`);
      }
    },
    [refresh, setLastMessage, setSelectedName],
  );

  // ★ v2.1: apply the observation display order to the scheme load order
  const handleApplyObservationOrder = useCallback(() => {
    setScheme((prev) => {
      if (!prev) return prev;
      const memberSet = new Set(prev.modKeys ?? []);
      const order: string[] = [];
      for (const k of effectiveDisplayOrder) {
        const g = prev.groups?.find((x) => x.id === k);
        if (g) {
          // ★ v2.1: intra-group order follows displayOrder positions, not g.modKeys
          const members = g.modKeys
            .filter((mk) => memberSet.has(mk))
            .sort((a, b) => {
              const ia = effectiveDisplayOrder.indexOf(a);
              const ib = effectiveDisplayOrder.indexOf(b);
              return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
            });
          for (const mk of members) if (!order.includes(mk)) order.push(mk);
        } else if (memberSet.has(k) && !order.includes(k)) {
          order.push(k);
        }
      }
      for (const mk of prev.modKeys ?? []) {
        if (!order.includes(mk)) order.push(mk);
      }
      const out = { ...prev, loadOrder: order };
      void saveScheme(out).catch(() => {});
      setLastMessage("已将观测顺序应用到加载顺序");
      return out;
    });
  }, [effectiveDisplayOrder, setLastMessage]);

  // ★ v2.1: export the selected scheme as a JSON file
  const handleExportScheme = useCallback(async () => {
    if (!selectedName) {
      setLastMessage("请先选择一个方案再导出");
      return;
    }
    try {
      const data = await loadScheme(selectedName);
      if (!data) {
        setLastMessage("方案读取失败");
        return;
      }
      const noteCount = Object.keys(data.modNotes ?? {}).length;
      const catCount = Object.keys(data.modCategories ?? {}).length;
      if (noteCount > 0 || catCount > 0) {
        const ok = await ask(
          `该方案包含 ${noteCount} 条备注与 ${catCount} 个分类信息。备注可能含个人记录，导出/分享前请检查。`,
          { title: "隐私提示", kind: "warning" },
        );
        if (!ok) return;
      }
      const path = await save({
        defaultPath: `${selectedName}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeFile(path, JSON.stringify(data, null, 2));
      setLastMessage(`方案 "${selectedName}" 已导出`);
    } catch (e) {
      setLastMessage(`导出失败: ${String(e)}`);
    }
  }, [selectedName, setLastMessage]);

  // ★ v2.1: import a scheme from a JSON file (v1 auto-migrated, version-checked)
  const handleImportScheme = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected) return;
      const raw = await readFile(selected as string);
      let parsed: ProfileData | ProfileDataV1;
      try {
        parsed = JSON.parse(raw);
      } catch {
        setLastMessage("导入失败: 文件格式无效，请确认选择的是 JSON 方案文件");
        return;
      }
      if (!parsed.name || !Array.isArray(parsed.enabledMods)) {
        setLastMessage("导入失败: 无效的方案文件");
        return;
      }
      if (parsed.version !== undefined && parsed.version > 2) {
        setLastMessage(`导入失败: 方案版本不兼容（文件版本 ${parsed.version}，当前支持版本 2）`);
        return;
      }
      // ★ v2.1: sanitize the imported name (Windows filename safety), ask first
      const rawName = parsed.name;
      const name = sanitizeSchemeName(rawName);
      if (!name) {
        setLastMessage("导入失败: 方案名仅含文件名非法字符");
        return;
      }
      if (name !== rawName) {
        const ok = await ask(
          `方案名 "${rawName}" 包含文件名非法字符（如 / \\ : * ? " < > |），将以 "${name}" 导入。是否继续？`,
          { title: "名称含非法字符", kind: "warning" },
        );
        if (!ok) return;
      }
      const migrated: ProfileData = isProfileV2(parsed) ? parsed : migrateProfileV1(parsed);
      // ★ v2.1: normalize the current struct (loadOrder derived when absent)
      const normalized: ProfileData = { ...migrated, name, loadOrder: ensureLoadOrder(migrated) };
      const existing = profiles.find((p) => p.name === normalized.name);
      if (existing) {
        const ok = await ask(`方案 "${normalized.name}" 已存在，是否覆盖？`, { title: "确认覆盖", kind: "warning" });
        if (!ok) return;
      }
      await saveProfile(normalized.name, JSON.stringify(normalized, null, 2));
      // ★ v2.1: switch to the imported scheme directly
      setSelectedName(normalized.name);
      const missing = detectMissingMods(normalized, mods);
      if (missing.size > 0) {
        setImportMissingMods(missing);
        setLastMessage(`方案 "${normalized.name}" 已导入，但 ${missing.size} 个 Mod 缺失`);
      } else {
        setLastMessage(name !== rawName ? `方案 "${normalized.name}" 已导入（已移除文件名非法字符）` : `方案 "${normalized.name}" 已导入`);
      }
      void refresh();
    } catch (e) {
      setLastMessage(`导入失败: ${String(e)}`);
    }
  }, [profiles, mods, setLastMessage, refresh, setSelectedName]);

  // ★ v2.1: rename the selected scheme (load → save with new name → delete old)
  const handleRenameScheme = useCallback(async (newName: string) => {
    if (!renameTarget) return;
    const name = sanitizeSchemeName(newName);
    if (!name) { setLastMessage("名称无效（仅含文件名非法字符）"); return; }
    if (name === renameTarget) { setLastMessage("名称未变化"); return; }
    if (profiles.some((p) => p.name === name)) { setLastMessage(`方案 "${name}" 已存在`); return; }
    try {
      const data = await loadScheme(renameTarget);
      if (!data) { setLastMessage("原方案读取失败"); return; }
      const renamed = { ...data, name };
      await saveProfile(name, JSON.stringify(renamed, null, 2));
      await deleteProfile(renameTarget);
      if (selectedName === renameTarget) setSelectedName(name);
      setLastMessage(`方案已重命名为 "${name}"`);
      void refresh();
    } catch (e) {
      setLastMessage(`重命名失败: ${String(e)}`);
    }
  }, [renameTarget, profiles, selectedName, setSelectedName, setLastMessage, refresh]);

  // ★ v3: "＋ 添加" menu — add mods or merge a whole collection
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addCollectionOpen, setAddCollectionOpen] = useState(false);
  const [mergeConflict, setMergeConflict] = useState<{
    collection: ModCollection;
    conflict: CollectionMergeConflict;
  } | null>(null);

  const applyCollectionMerge = useCallback(
    (col: ModCollection, conflict: CollectionMergeConflict, mode: "all" | "partial") => {
      setScheme((prev) => {
        if (!prev) return prev;
        const next = mergeCollectionIntoScheme(prev, col, conflict, mode);
        void saveScheme(next).catch(() => {});
        return next;
      });
      setMergeConflict(null);
      setAddCollectionOpen(false);
      const skipped = mode === "partial" ? `（跳过 ${conflict.duplicateModKeys.length} 个重复 Mod）` : "";
      setLastMessage(`已从集合 "${col.name}" 合并${skipped}`);
      // ★ v2.1: refresh the dropdown count after merging members
      void refresh();
    },
    [setLastMessage, refresh],
  );

  const handleAddCollection = useCallback(
    (collectionId: string) => {
      const col = useCollectionStore.getState().collections.find((c) => c.id === collectionId);
      if (!col || !scheme) return;
      const conflict = analyzeCollectionMerge(scheme, col);
      if (conflict.duplicateModKeys.length > 0 || conflict.duplicateGroupNames.length > 0) {
        setMergeConflict({ collection: col, conflict });
      } else {
        applyCollectionMerge(col, conflict, "all");
      }
    },
    [scheme, applyCollectionMerge],
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
          onRename={(name) => setRenameTarget(name)}
          headerAction={(close) => (
            <div className="px-2 py-1.5 border-b border-slate-700 flex gap-1">
              <button
                onClick={() => {
                  close();
                  setCreateSchemeOpen(true);
                }}
                className="flex-1 px-1.5 py-1 text-xs text-center text-blue-400 hover:bg-slate-700/70 transition-colors"
              >
                新建
              </button>
              <button
                onClick={() => {
                  close();
                  void handleExportScheme();
                }}
                disabled={!selectedName}
                className="flex-1 px-1.5 py-1 text-xs text-center text-slate-300 hover:bg-slate-700/70 disabled:text-slate-600 disabled:hover:bg-transparent transition-colors"
              >
                导出
              </button>
              <button
                onClick={() => {
                  close();
                  void handleImportScheme();
                }}
                className="flex-1 px-1.5 py-1 text-xs text-center text-slate-300 hover:bg-slate-700/70 transition-colors"
              >
                导入
              </button>
            </div>
          )}
        />

        {/* ★ v2.1: display-mode toggle — observation (groups) vs load order (flat) */}
        {scheme && (
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
          <div className="relative shrink-0">
            <button
              onClick={() => setAddMenuOpen((v) => !v)}
              className="text-xs px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white rounded cursor-pointer"
            >
              ＋ 添加 ▾
            </button>
            {addMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-slate-800 border border-slate-600
                              rounded-lg shadow-xl z-50 py-1">
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    setAddOpen(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700/70 transition-colors"
                >
                  添加 Mod…
                </button>
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    setAddCollectionOpen(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700/70 transition-colors"
                >
                  添加集合…
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Member list — observation (groups) or load order (flat) */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!scheme ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-slate-500">从上方选择一个方案查看成员</p>
          </div>
        ) : orderView === "load" ? (
          <LoadOrderList
            mods={loadMods}
            onMoveUp={(key) => handleLoadMove(key, -1)}
            onMoveDown={(key) => handleLoadMove(key, 1)}
            onMoveToPosition={(key, pos) => handleOrderChange(key, pos)}
            onToggle={handleToggleMember}
          />
        ) : (
          <ModList
            saving={false}
            onSelectMod={(key) => setConfigModKey(key)}
            controlled={{
              mods: displayMods,
              groups: scheme.groups ?? [],
              displayOrder: effectiveDisplayOrder,
              setGroups: handleGroupsChange,
              setDisplayOrder: handleDisplayOrderChange,
              toggleMod: (fileId, enabled) => handleToggleMember(fileId, enabled),
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
              schemes: profiles,
              collections,
              containerKind: "scheme",
              onRemoveFromScheme: (keys) => handleRemoveMembers(keys),
              onAddToScheme: (name, keys) => void handleAddToScheme(name, keys),
              onAddToCollection: (id, keys) => handleAddToCollection(id, keys),
              onCreateScheme: () => setCreateSchemeOpen(true),
              onCreateCollection: () => setLastMessage("请到集合页新建集合"),
            }}
            onSaveSelectionAsCollection={() => {}}
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
              const next = addModsToScheme(
                prev,
                keys,
                buildModMeta(mods, keys),
                buildModSettings(mods, keys),
              );
              void saveScheme(next).catch(() => {});
              return next;
            });
            // ★ v2.1: refresh the dropdown count after adding members
            void refresh();
          }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* ★ v3: per-scheme mod config editor (snapshot → scheme.modSettings, not disk) */}
      {configModKey && scheme && (() => {
        const mod = displayMods.find((m) => `${m.source}_${m.fileId}` === configModKey);
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
                  setScheme((prev) => {
                    if (!prev) return prev;
                    const next = {
                      ...prev,
                      modSettings: {
                        ...(prev.modSettings ?? {}),
                        [configModKey]: { ...settings },
                      },
                    };
                    void saveScheme(next).catch(() => {});
                    return next;
                  });
                }}
              />
            </div>
          </div>
        );
      })()}

      {/* ★ v3: create-scheme modal */}
      {createSchemeOpen && (
        <CreateDialog
          title="新建方案"
          namePlaceholder="方案名称..."
          defaultName={dateDefaultName("方案")}
          onSubmit={(name) => void handleCreateScheme(name)}
          onClose={() => setCreateSchemeOpen(false)}
        />
      )}

      {/* ★ v3: add-collection picker */}
      {addCollectionOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[420px] max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700">
              <h2 className="text-sm font-semibold text-slate-200">从集合添加</h2>
              <button onClick={() => setAddCollectionOpen(false)} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
              {collections.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">暂无集合</p>
              ) : (
                collections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleAddCollection(c.id)}
                    className="w-full text-left px-3 py-2 rounded text-xs text-slate-200 hover:bg-slate-700/70 transition-colors"
                  >
                    <span className="block truncate">{c.name}</span>
                    <span className="block text-[10px] text-slate-500">
                      {c.modKeys.length} Mod{c.groups?.length ? ` · ${c.groups.length} 分组` : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ★ v3: collection-merge conflict dialog — all or partial */}
      {mergeConflict && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60">
          <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[440px] p-5">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">合并冲突</h2>
            <p className="text-xs text-slate-400 mb-2">集合「{mergeConflict.collection.name}」与当前方案存在以下冲突：</p>
            <ul className="text-xs text-slate-300 space-y-1 mb-4">
              {mergeConflict.conflict.duplicateModKeys.length > 0 && (
                <li>🔁 重复 Mod：{mergeConflict.conflict.duplicateModKeys.length} 个已存在于方案</li>
              )}
              {mergeConflict.conflict.duplicateGroupNames.length > 0 && (
                <li>🗂 分组名冲突：{mergeConflict.conflict.duplicateGroupNames.join("、")}</li>
              )}
            </ul>
            <p className="text-xs text-slate-500 mb-4">
              全部调整：合并全部内容（重复项去重、分组强制合并）；部分调整：跳过冲突项（重复 Mod 与同名分组不并入），只添加其余部分。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMergeConflict(null)}
                className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() =>
                  applyCollectionMerge(
                    mergeConflict.collection,
                    mergeConflict.conflict,
                    "partial",
                  )
                }
                className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
              >
                部分调整（跳过冲突）
              </button>
              <button
                onClick={() =>
                  applyCollectionMerge(
                    mergeConflict.collection,
                    mergeConflict.conflict,
                    "all",
                  )
                }
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
              >
                全部调整
              </button>
            </div>
          </div>
        </div>
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
          onOpenConfig={() => setConfigModKey(contextMenu.key)}
          onAddToScheme={(name) => void handleAddToScheme(name, contextKeys)}
          onAddToCollection={(id) => handleAddToCollection(id, contextKeys)}
          onCreateScheme={() => {
            setCreateSchemeOpen(true);
          }}
          onCreateCollection={() => {
            setLastMessage("请到集合页新建集合");
          }}
          onRemoveFromContainer={() => handleRemoveMembers(contextKeys)}
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

      {importMissingMods && (
        <MissingModsDialog
          missing={importMissingMods}
          onClose={() => setImportMissingMods(null)}
        />
      )}

      {renameTarget && (
        <RenameDialog
          title="重命名方案"
          defaultValue={renameTarget}
          onSubmit={(name) => void handleRenameScheme(name)}
          onClose={() => setRenameTarget(null)}
        />
      )}
    </div>
  );
}

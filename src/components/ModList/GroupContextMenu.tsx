import type { ModGroup } from "../../lib/types";
import ContextMenu from "./ContextMenu";

interface Props {
  group: ModGroup;
  x: number;
  y: number;
  onClose: () => void;
  onRename: (groupId: string) => void;
  onToggleCollapse: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onUngroup: (groupId: string) => void;
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700/70 transition-colors ${
        danger ? "text-red-400 hover:text-red-300" : "text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 border-t border-slate-700" />;
}

export default function GroupContextMenu({
  group,
  x,
  y,
  onClose,
  onRename,
  onToggleCollapse,
  onDelete,
  onUngroup,
}: Props) {
  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <MenuItem onClick={() => handleAction(() => onRename(group.id))}>
        重命名
      </MenuItem>
      <MenuItem onClick={() => handleAction(() => onToggleCollapse(group.id))}>
        {group.collapsed ? "展开" : "折叠"}
      </MenuItem>

      <MenuSeparator />

      <MenuItem
        onClick={() => handleAction(() => onUngroup(group.id))}
        danger={!!(group.modKeys.length)}
      >
        取消分组
      </MenuItem>
      <MenuItem onClick={() => handleAction(() => onDelete(group.id))} danger>
        删除分组
      </MenuItem>
    </ContextMenu>
  );
}

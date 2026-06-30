import type { ModGroup } from "../../lib/types";

interface Props {
  group: ModGroup;
  isEditing: boolean;
  isDragging: boolean;
  dragOverGroupId: string | null;
  onToggle: (groupId: string) => void;
  onRename: (groupId: string, name: string) => void;
  onDelete: (groupId: string) => void;
  onDragMouseDown: (e: React.MouseEvent, groupId: string) => void;
  onStartEdit: (groupId: string) => void;
  onStopEdit: () => void;
}

export default function ModGroupHeader({
  group,
  isEditing,
  isDragging,
  dragOverGroupId,
  onToggle,
  onRename,
  onDelete,
  onDragMouseDown,
  onStartEdit,
  onStopEdit,
}: Props) {
  const isDragTarget = dragOverGroupId === group.id;

  return (
    <div
      data-folder-id={group.id}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, label, select")) return;
        onDragMouseDown(e, group.id);
      }}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border select-none ${
        isDragTarget
          ? "border-green-500 bg-green-950/40"
          : "border-blue-700/50 bg-blue-950/20"
      } ${isDragging ? "opacity-30" : ""}`}
    >
      {/* Collapse toggle */}
      <span
        className="text-xs text-blue-300 cursor-pointer"
        onClick={() => onToggle(group.id)}
      >
        {group.collapsed ? "\u25B6" : "\u25BC"}
      </span>

      {/* Name */}
      {isEditing ? (
        <input
          autoFocus
          defaultValue={group.name}
          onBlur={onStopEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val) onRename(group.id, val);
              onStopEdit();
            } else if (e.key === "Escape") {
              onStopEdit();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-blue-300 bg-blue-950/50
                     border border-blue-600 rounded px-1 outline-none
                     min-w-[6em] w-auto"
        />
      ) : (
        <span
          className="text-sm font-medium text-blue-300 cursor-pointer min-w-[2em]"
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit(group.id);
          }}
        >
          {group.name}
        </span>
      )}

      {/* Mod count */}
      <span className="text-xs text-slate-500">({group.modKeys.length})</span>

      {/* Delete */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(group.id);
        }}
        title="删除分组"
        className="text-xs text-slate-500 hover:text-red-400 cursor-pointer transition-colors ml-auto"
      >
        删除
      </button>
    </div>
  );
}

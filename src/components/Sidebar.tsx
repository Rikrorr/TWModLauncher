import type { PageKey } from "../lib/types";

interface Props {
  current: PageKey;
  onNavigate: (page: PageKey) => void;
}

const NAV_ITEMS: { key: PageKey; icon: string; label: string }[] = [
  { key: "launch", icon: "🚀", label: "启动" },
  { key: "schemes", icon: "📦", label: "方案" },
  { key: "collections", icon: "🗂", label: "集合" },
  { key: "mods", icon: "📖", label: "Mod" },
  { key: "settings", icon: "⚙️", label: "设置" },
  { key: "logs", icon: "📋", label: "日志" },
];

/** Left navigation rail — switches the active sub-page. */
export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <nav className="w-14 shrink-0 border-r border-slate-700 bg-slate-800/80 flex flex-col items-center py-3 gap-1">
      {NAV_ITEMS.map((item) => {
        const active = current === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            title={item.label}
            className={`w-10 h-10 flex items-center justify-center rounded-lg text-lg
                       transition-colors cursor-pointer ${
                         active
                           ? "bg-blue-600/30 text-blue-300 border border-blue-600/50"
                           : "text-slate-400 hover:bg-slate-700/60 hover:text-slate-200 border border-transparent"
                       }`}
          >
            {item.icon}
          </button>
        );
      })}
    </nav>
  );
}

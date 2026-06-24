/** Map English tag names to Chinese for display */
const TAG_MAP: Record<string, string> = {
  Arts: "美化",
  "Compatible Mods": "适配版本",
  Frameworks: "框架",
  Stories: "剧情",
  Extensions: "拓展",
  Modifications: "修改",
  Optimizations: "优化",
  Display: "显示",
  Configurations: "配置",
};

/** Resolve a tag name to its Chinese display form. Falls back to the original if no mapping. */
export function resolveTagName(raw: string): string {
  return TAG_MAP[raw] ?? raw;
}

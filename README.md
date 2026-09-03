# TWModLauncher v2.0.1

太吾绘卷 Mod 启动器 —— 基于 Tauri v2 的《太吾绘卷》模组管理工具。

## 功能

- **子页架构** — 左侧栏六页导航：启动 / 方案 / 集合 / 已读取 Mod / 设置 / 日志
- **Mod 扫描** — 自动识别 Steam 创意工坊和本地 Mod 目录
- **启用 / 禁用** — 开关即时同步到 `ModSettings.Lua`，游戏内生效
- **设置编辑** — Toggle / Slider / Dropdown 表单，修改 `Settings.Lua`
- **Mod 分组** — 拖进拖出；观测（分组浏览）与加载（扁平序列）双视图一键切换
- **加载顺序** — 独立 `loadOrder`，0 基编号；「应用顺序」把观测排列一次性写入加载序列；禁用 Mod 自动归到加载末尾，启用上移
- **方案管理** — 保存 / 加载 / 导出 / 导入多套 Mod 组合（含分组、加载顺序、标签、备注）
- **集合管理** — 离线分组包，成员浏览，观测 / 加载双视图，导出 / 导入，一键由集合建方案
- **标签** — 自定义标签 + 颜色，搜索 + 单击单选 / Ctrl / Shift 多选，重名检测
- **分类筛选** — 工坊 / 本地 × 正常 / 残留，支持模糊搜索，标签或 / 与筛选
- **双向刷新** — 一键检测新增和已移除的 Mod（取消订阅会有残留的哦）
- **游戏启动** — 内置启动按钮，运行状态实时检测
- **日志记录** — 默认地址 `%APPDATA%/TWModLauncher/logs/TWModLauncher.log.YYYY-MM-DD`

## 开发

### 环境

- Node.js 20+
- Rust stable
- Windows 10/11

### 启动

```bash
npm install
npm run tauri:dev
```

### 构建

```bash
npm run tauri build
```

产物：`src-tauri/target/release/bundle/nsis/TWModLauncher_2.0.1_x64-setup.exe`

### 项目结构

```
src/
├── components/
│   ├── ModList/           # Mod 卡片列表 + 筛选栏 + 右键/多选菜单 + 拖拽
│   ├── Scheme/            # 加载顺序列表
│   ├── SettingsEditor/    # Mod 设置表单编辑器
│   ├── common/            # 容器下拉框、添加 Mod 面板、标签选择器、新建对话框等
│   └── ProfileManager/    # MissingModsDialog（缺失 Mod 提示）
├── pages/                 # 启动 / 方案 / 集合 / 已读取 Mod / 设置 / 日志
├── hooks/                 # useModScanner（扫描）、useConflictDetection（冲突）
├── lib/                   # luaParser（Lua AST）、tauriApi（命令桥接）、types
├── store/                 # useAppStore / useModStore / useCollectionStore / useCategoryStore / useNoteStore
└── utils/                 # schemeMembers（方案/集合工具）、generateModSettings、migrateProfile 等
```

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri v2 |
| 前端 | React 19 + TypeScript |
| 构建 | Vite |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS |
| Lua 解析 | luaparse |
| 搜索 | Fuse.js |
| 安装器 | NSIS |

## 许可

MIT

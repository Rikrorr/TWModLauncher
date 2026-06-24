# TWModLauncher v1.0.0

太吾绘卷 Mod 启动器 —— 基于 Tauri v2 的《太吾绘卷》模组管理工具。

## 功能

- **Mod 扫描** — 自动识别 Steam 创意工坊和本地 Mod 目录
- **启用 / 禁用** — 开关即时同步到 `ModSettings.Lua`，游戏内生效
- **设置编辑** — Toggle / Slider / Dropdown 表单，修改 `Settings.Lua`
- **方案管理** — 保存 / 加载多套 Mod 组合
- **分类筛选** — 工坊 / 本地 × 正常 / 残留，支持模糊搜索
- **双向刷新** — 一键检测新增和已移除的 Mod
- **游戏启动** — 内置启动按钮，运行状态实时检测

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

产物：`src-tauri/target/release/bundle/nsis/TWModLauncher_1.0.0_x64-setup.exe`

### 项目结构

```
src/
├── components/
│   ├── ModList/           # Mod 卡片列表 + 筛选栏
│   ├── SettingsEditor/    # Mod 设置表单编辑器
│   └── ProfileManager/    # 方案保存 / 加载 / 删除
├── hooks/
│   └── useModScanner.ts   # Mod 扫描（初始 + 增量刷新）
├── lib/
│   ├── luaParser.ts       # Lua AST 解析
│   ├── tauriApi.ts        # Tauri 命令桥接
│   └── types.ts           # 类型定义
├── store/
│   ├── useAppStore.ts     # 全局状态（路径、消息）
│   └── useModStore.ts     # Mod 列表状态
├── utils/
│   ├── generateModSettings.ts  # ModSettings.Lua 生成与补丁
│   └── renderColoredText.tsx   # 颜色标签渲染
├── App.tsx                # 主界面
└── main.tsx               # 入口

src-tauri/src/commands/
├── game_launcher.rs       # 游戏启动与进程监控
├── game_path.rs           # 游戏路径验证
├── mod_scanner.rs         # 目录扫描
├── mod_settings.rs        # Lua 文件读写
└── profiles.rs            # 方案 JSON 存储
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

# LuaParser 模块需求说明书

> **模块位置**：`src/lib/luaParser.ts`（373 行）
> **外部依赖**：`luaparse`（npm 第三方 Lua 解析库）
> **编写依据**：源代码逆向分析 + 《太吾绘卷》Mod 社区约定格式
> **版本**：v1.0 / 2026-06-28

---

## 1. 模块概述

本模块负责将《太吾绘卷》Mod 相关的 Lua 源文件文本（`.lua` 文件内容）解析为 TypeScript 结构化数据，供前端 UI 展示和编辑。

**核心功能**：
- 解析单个 Mod 的 `Config.lua` → Mod 元数据 + 设定项定义
- 解析单个 Mod 的 `Settings.Lua` → 当前设定键值对
- 解析全局 `ModSettings.Lua` → 已启用 Mod 列表 + 加载顺序

**上下文位置**：
```
Rust 后端读取 .lua 文件文本
    ↓
前端 luaParser.ts 解析文本 → 结构化数据
    ↓
useModStore / App.tsx 消费数据用于展示和编辑
```

---

## 2. 类型系统

### 2.1 输出类型

| 类型名 | 用途 | 关键字段 |
|---|---|---|
| `ParsedConfig` | Mod 的 Config.lua 解析结果 | title, author, defaultSettings, parseError |
| `ModSettingDef` | 单个设定项的定义 | settingType, key, defaultValue, options |
| `ParsedModSettings` | 全局 ModSettings.Lua 解析结果 | enabledWorkshopMods, enabledLocalMods, modOrder |
| `Record<string, unknown>` | Settings.Lua 的解析结果 | 任意字符串 key → 任意类型 value |

### 2.2 输入约束

所有 `raw: string` 参数的合法值包括：
- 正常格式的合法 Lua 源码（使用 `return { ... }` 格式）
- 仅包含空白字符（空格、换行、制表符）
- 非法 Lua 语法（所有解析函数必须容错，不抛出异常）
- 任何 Lua 源码（即使结构与预期不同，函数也不会崩溃）

---

## 3. 公开函数规格

### 3.1 `parseConfigLua(raw: string): ParsedConfig`

#### 功能
将 Mod 的 `Config.lua` 文本解析为结构化元数据。

#### 输入示例

```lua
return {
    Title = "美化UI",
    Author = "张三",
    Version = "1.2",
    GameVersion = "0.1.5",
    Description = "一个美化界面的Mod",
    Tags = { "Arts", "Display" },
    NeedRestart = false,
    DefaultSettings = {
        {
            SettingType = "Toggle",
            Key = "EnableFeature",
            DisplayName = "启用特性",
            DefaultValue = true,
        },
    },
}
```

#### 输出约束（不变量）

| 约束 | 说明 |
|---|---|
| **永不抛出异常** | 所有错误被 catch，返回含默认值的 ParsedConfig |
| **每个字段都有值** | 不存在 undefined，调用方不需要空值检查 |
| **`parseError: false`** | 当且仅当解析成功 |
| **`parseError: true`** | 当且仅当 `luaparse.parse()` 抛出异常 |

#### 字段映射规则

这是本函数最核心的设计——**字段名大小写兼容**：

```typescript
// 实际代码：每个字段用 ?? 链同时检查 PascalCase 和 camelCase
title:       table.Title       ?? table.title       ?? defaults.title
author:      table.Author      ?? table.author      ?? defaults.author
version:     table.Version     ?? table.version     ?? defaults.version
tags:        table.Tags        ?? table.tags        ?? table.TagList ?? table.tagList
needRestart: table.NeedRestart ?? table.needRestart ?? defaults.needRestart
```

**设计原因**：Lua 是大小写敏感的。不同 Mod 作者会混用 `Title`、`title`、`TITLE` 等写法。`??` 链按优先级依次尝试，确保总能匹配到值。

**注意**：当前实现仅支持首字母大写的 PascalCase 和首字母小写的 camelCase 两种写法。不会匹配全大写（如 `TITLE`）或驼峰中间大写（如 `gameVersion` / 仅检查了 `gameVersion` 但 Lua 端实际用的是 `GameVersion`）。

#### 默认值

| 字段 | 默认值 | 说明 |
|---|---|---|
| `title` | `""` | 空字符串表示未定义标题 |
| `author` | `"未知"` | 作者未知时的展示文案 |
| `version` | `""` | 空字符串表示无版本号 |
| `description` | `""` | 无描述 |
| `gameVersion` | `""` | 无游戏版本要求 |
| `tags` | `[]` | 空数组，非 null |
| `needRestart` | `false` | 默认不需要重启 |
| `defaultSettings` | `[]` | 空数组，非 null |
| `parseError` | `false` | 无错误 |

#### 边界场景

1. **空字符串/仅空白**：直接返回所有默认值，不调用 `luaparse.parse()`（避免不必要的解析）

2. **合法 Lua 但无 `return` 语句**：`tableFromReturn` 返回空对象 `{}`，所有字段取默认值

3. **合法 Lua 但 `return` 的不是 Table**（例如 `return "hello"`）：同上，返回默认值

4. **Lua 语法错误**：catch 异常，返回 `{ ...defaults, parseError: true }`

5. **Table 中有额外字段**：被忽略，不影响解析结果

6. **字段值的类型异常**（例如 `Title = 123`）：`String()` 强制转为 "123"，不抛出异常

---

### 3.2 `parseSettingsLua(raw: string): Record<string, unknown>`

#### 功能
解析单个 Mod 的 `Settings.Lua`，返回当前设定值的键值对。

#### 输入示例

```lua
return {
    EnableFeature = true,
    MaxCount = 50,
    Mode = "Auto",
}
```

#### 行为
- 空输入 → 返回 `{}`
- Lua 语法错误 → 返回 `{}`（静默容错）
- 返回的 Table 中的值递归解析（数字、字符串、布尔、nil、嵌套表均支持）

---

### 3.3 `parseModSettingsLua(raw: string): ParsedModSettings`

#### 功能
解析游戏的全局 `ModSettings.Lua` 文件，提取已启用 Mod 列表和加载顺序。

#### 支持的两种格式

**格式 A — `return { ... }` 风格（优先）：**

```lua
return {
    EnabledWorkshopMods = {
        [1] = "1_123456789",
        [2] = "1_987654321",
    },
    EnabledLocalMods = {
        [1] = "0_MyMod",
    },
    ModOrder = {
        ["1_123456789"] = 0,
        ["0_MyMod"] = 1,
    },
}
```

**格式 B — 顶层赋值语句风格（回退）：**

```lua
EnabledWorkshopMods = {
    "1_123456789",
    "1_987654321",
}
ModOrder = {
    ["1_123456789"] = 0,
}
```

#### 优先顺序规则

1. 先尝试从 `return { ... }` 中提取
2. 如果 `return` 格式未提供某个 section（例如 `EnabledWorkshopMods` 数组为空），再检查顶层赋值语句
3. **判断条件**：`result.enabledWorkshopMods.length === 0` — 只有当 return 格式**没有提供有效数据**时，才从顶层赋值语句读取。这防止了顶层赋值语句覆盖 return 格式的有效数据

**设计原因**：游戏的不同版本或不同 Mod 工具可能使用不同的文件格式。两种都支持可以减少兼容性问题。

#### 过滤规则

`EnabledWorkshopMods` 和 `EnabledLocalMods` 的最终值会经过过滤：

```typescript
.filter((v): v is string => typeof v === "string" && v.length > 0)
```

这意味着：
- 非字符串元素（数字、布尔值等）被丢弃
- 空字符串 `""` 被丢弃

**设计原因**：Lua 表可能存在 "空洞"（sparse arrays）或类型错误的数据，过滤确保下游只消费有效的 Mod Key。

#### 数据格式兼容

`EnabledWorkshopMods` 的值既可能是纯数组，也可能是整数 key 的对象：
- 纯数组 `["1_a", "1_b"]` — 直接使用
- 对象 `{1: "1_a", 2: "1_b"}` — 使用 `Object.values()` 提取

`ModOrder` 仅接受值类型为 `number` 的条目，非数字值被跳过。

---

## 4. 内部函数规格

### 4.1 `extractValue(node: LuaNode): unknown`

递归将 luaparse AST 节点转换为 JavaScript 值。

**支持的类型**：StringLiteral, NumericLiteral, BooleanLiteral, NilLiteral, TableConstructorExpression, UnaryExpression
**不支持的类型**：返回 `null`（例如函数调用、二元表达式等）

### 4.2 `tableFromReturn(ast): Record<string, unknown>`

从 AST 的 `ReturnStatement` 中提取 `TableConstructorExpression` 并转换为 JS 对象。

### 4.3 `parseTags(raw: unknown): string[]`

将 tags 输入转为字符串数组：
- 纯数组 → 所有元素转字符串
- 对象 → `Object.values()` 再转字符串
- 其他类型 → 返回空数组 `[]`

### 4.4 `parseDefaultSettings(raw: unknown): ModSettingDef[]`

解析 DefaultSettings 列表，每个元素经 `parseOneSetting` 验证和转换。

### 4.5 `parseOneSetting(raw: unknown): ModSettingDef | null`

解析单个设定项，验证逻辑：
- 输入必须是非 null 对象
- `SettingType` 必须为 `"Toggle" | "Slider" | "Dropdown"` 之一，否则返回 `null`（丢弃）
- `Key` 为空字符串的条目也被丢弃（无意义数据）

### 4.6 `parseOptions(raw: unknown): Record<number, string> | undefined`

解析下拉选项映射表 `{ 0 = "关闭", 1 = "开启" }`：
- 非对象类型 → 返回 `undefined`
- 空对象 → 返回 `undefined`
- 键值中只有数字 key 被保留，非数字 key 被跳过

---

## 5. 设计决策记录

| 决策 | 原因 |
|---|---|
| **永远不抛出异常** | 单个 Mod 解析失败不应阻止整个扫描流程。`useModScanner` 依赖此行为 |
| **字段名 PascalCase/camelCase 双检查** | 社区 Mod 没有严格的命名规范，兼顾两种常见写法 |
| **不支持全大写 `TITLE` 等** | 非设计限制，仅仅是尚未遇到使用全大写命名的 Mod |
| **`parseError` 是字段而非异常** | 方便在 Mod 列表中标记"解析失败"状态，UI 可据此显示警告 |
| **`author` 默认值 `"未知"` 而非 `""`** | 显示层面考虑，中文用户看到"未知"比空白更友好 |
| **返回结果始终有 `defaultSettings: []`** | 下游 `SettingsEditor` 会遍历此数组，空数组避免 null 检查 |
| **`extractValue` 不支持的 AST 节点返回 `null`** | Lua 的复杂表达式（函数调用等）在 Mod 配置中不会出现，返回 null 是安全的默认行为 |
| **ModSettings 两种格式都支持** | 游戏不同版本的文件格式不同，保证向后兼容 |
| **空字符串从 enabledMods 过滤掉** | 防止垃圾数据导致游戏加载错误 |
| **`ModOrder` 仅接受数字值** | Lua 中可能混入字符串 → 类型安全保证下游排序逻辑正确 |

---

## 6. 已知限制

1. **字段名仅支持两种大小写模式**：不支持全大写（`TITLE`）、下划线分隔（`title_name`）等变体
2. **不支持嵌套 `return` 以外的顶层语句**：只解析最后一条 `ReturnStatement`
3. **`extractValue` 不支持 BinaryExpression/FunctionDeclaration/MemberExpression**：它们返回 `null`
4. **Settings.Lua 解析无错误标记**：与 Config.lua 的 `parseError` 不同，Settings.Lua 解析失败静默返回 `{}`，调用方无法知道是否出错
5. **ModSettings.Lua 解析失败也静默**：当 `luaparse.parse()` 抛出异常时，返回默认空值（空数组 + 空对象），前端无法区分"文件为空"和"解析失败"

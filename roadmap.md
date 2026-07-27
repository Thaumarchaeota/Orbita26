# Orbita 重构 Roadmap

> **状态**：Phase 0–6 已落地；**v0.0.9 已验收**（2026-07-28）。前端 `tsc` + Rust `cargo check` 通过。  
> **约束**：用户可见功能、交互、快捷键零变更。旧数据自动迁移，可回滚。  
> **目标**：架构分层清晰；配置归 `settings.json`；所有个人数据落在「设置 → 数据存储位置」内。

## 更新日志

| 版本 | 日期 | 摘要 |
| ---- | ---- | ---- |
| **0.0.9** | 2026-07-28 | 栅格 `topGrid`/`dockLeftGrid` + v5 迁移；上应用/下书签对调修复；Tile 六键尺寸；favicon 乐观更新；Obsidian 笔记 tab；象耳芋 Logo；Tile 排版/滚动 |
| **0.0.8** | 2026-07-27 | 书签/应用/浮层/本地文件树收官；本地树指示线拖拽 |
| **0.0.7** | 2026-07-27 | 数据架构重构，dataDir 归集 |

---

## 0. 现状快照

### 0.1 数据散落一览

| 数据 | 当前位置 | 目标位置 |
|------|----------|----------|
| 主题 | `{dataDir}/settings.json` | `settings.json` → `theme` |
| 数据目录指针 | `%APPDATA%/com.orbita.app/bootstrap.json` | 保留（必须先知道 dataDir） |
| AI 配置 | `{dataDir}/ai/config.json` | 合并进 `settings.json` → `ai` |
| AI 对话 | `{dataDir}/ai/conversations/*.json` | 不变 |
| 书签 | `localStorage` `orbita.bookmarks` | `{dataDir}/bookmarks.json` |
| 应用 | `localStorage` `orbita.apps` | `{dataDir}/apps.json` |
| 本地文件列表 | `localStorage` `orbita.local.files` | `{dataDir}/local-files.json` |
| 搜索引擎 / 本地 Tab | `localStorage` `engine` / `localTab` | `settings.json` → `ui` |
| 当前对话 ID | `localStorage` `orbita.ai.activeConversation` | `settings.json` → `ui.activeConversationId` |
| 应用图标缓存 | `%APPDATA%/com.orbita.app/icons/` | `{dataDir}/cache/icons/` |
| Favicon 缓存 | `%APPDATA%/com.orbita.app/favicons/` | `{dataDir}/cache/favicons/` |
| v2ray 路径 | `lib.rs` 硬编码 | `settings.json` → `integrations.v2ray.exePath` |
| Zotero 数据目录 | `zotero.rs` 硬编码 | `settings.json` → `integrations.zotero.dataDir` |
| Obsidian 笔记目录 | `zotero.rs` 硬编码 | `settings.json` → `integrations.zotero.articleNoteDir` |

### 0.2 Web 预览模式（`dev-web.bat`）

| Tauri 路径 | Web 模拟 |
|------------|----------|
| `{dataDir}/*` | `localStorage` 键 `orbita.data.{相对路径}` |
| `bootstrap.json` | `localStorage` `orbita.bootstrap`（已有） |

---

## 1. 目标目录结构

```
%APPDATA%/com.orbita.app/
└── bootstrap.json              # 仅 { "dataDir": "..." }，不可消灭

{dataDir}/                      # 用户在设置中配置
├── settings.json               # 所有偏好 + 集成路径 + AI 配置
├── bookmarks.json
├── apps.json
├── local-files.json
├── ai/
│   └── conversations/
│       └── {uuid}.json
├── cache/
│   ├── icons/{id}.png
│   └── favicons/{id}.png
└── .migration-backup-{ts}/     # 迁移时自动备份（可手动删）
```

---

## 2. 目标 `settings.json` Schema

```jsonc
{
  "version": 1,
  "theme": "light",                    // "light" | "dark"
  "ui": {
    "engineId": "bing",
    "localTab": "file",                // "file" | "literature" | "note"
    "activeConversationId": null       // string | null
  },
  "integrations": {
    "v2ray": {
      "exePath": ""
    },
    "zotero": {
      "dataDir": "",
      "articleNoteDir": ""
    }
  },
  "ai": {
    "defaultPrompt": "",
    "activeEntryId": "deepseek-default",
    "activeModel": "deepseek-chat",
    "entries": [
      {
        "id": "deepseek-default",
        "name": "DeepSeek",
        "apiKey": "",
        "baseUrl": "https://api.deepseek.com",
        "models": ["deepseek-chat", "deepseek-reasoner"]
      }
    ]
  }
}
```

### 独立数据文件 Schema（简要）

**bookmarks.json** — `Bookmark[]`  
`{ id, name, url, icon? }`

**apps.json** — `AppItem[]`  
`{ id, name, path, icon? }`

**local-files.json** — `LocalFileItem[]`  
`{ id, name, path, kind: "file"|"folder" }`

---

## 3. 目标架构

```
main.ts
  initBootstrap()
  migrateIfNeeded()
  initSettings()
  initIntegrations()
    ├── shellIntegration
    └── aiIntegration          # 从 view.ts 拆出

core/
  html.ts                      # escHtml / escAttr，全项目唯一
  mount.ts                     # scopedMount(el, fn) → AbortController teardown
  data/
    types.ts                   # Settings, Bookmark, AppItem, …
    paths.ts                   # 相对路径常量
    client.ts                  # readJson / writeJson / exists / listDir
    settings.ts                # load/save/getSettings（替代 core/settings.ts 职责）
    migrate.ts                 # v0 → v1 一次性迁移

integrations/
  shell/
    repos/
      bookmarks.ts
      apps.ts
      local-files.ts
    view.ts                    # 布局 + 搜索 + 侧栏，不直接 mount AI
    local-panel.ts             # 修 Tab 生命周期
    …
  ai/
    index.ts                   # aiIntegration { id, init }
    panel.ts
    config.ts                  # 读 settings.ai，不再独立 ai/config.json
    conversations.ts
    …
```

### 数据访问铁律

1. 业务模块**禁止**直接 `localStorage` / 直接 `invoke("read_ai_config")`
2. 一律经 `core/data/client.ts`
3. Rust 读写统一走 `data.rs`，缓存目录基于 `get_data_dir()`

---

## 4. 实施阶段

### Phase 0 — 基线与验收标准

**产出**：迁移前后 JSON 样例、手测清单（本文 §8）

**检查项**：
- [ ] 清点所有 `localStorage` key（见 §0.1）
- [ ] 清点所有 Rust 硬编码路径
- [ ] 记录本机当前书签数、应用数、本地文件数、对话数，作迁移对照

---

### Phase 1 — `core/data` 数据层 + Rust 扩展

#### 1.1 前端新建文件

| 文件 | 职责 |
|------|------|
| `core/data/types.ts` | `Settings`、`UiPrefs`、`Integrations`、`AiConfig` 等类型 |
| `core/data/paths.ts` | `SETTINGS`, `BOOKMARKS`, `APPS`, `LOCAL_FILES`, `AI_CONV_DIR`, `CACHE_ICONS`, `CACHE_FAVICONS` |
| `core/data/client.ts` | `isTauri()` 分支；Tauri → `invoke`；Web → `localStorage` 模拟 |
| `core/data/settings.ts` | `loadSettings` / `saveSettings` / `getSettings` / `patchSettings` |
| `core/html.ts` | `escHtml`, `escAttr` |

#### 1.2 Rust `data.rs` 改动

- [ ] 扩展 `AppSettings`（或重命名 `Settings`）包含 `version`, `ui`, `integrations`, `ai`
- [ ] `read_settings` / `write_settings` 读写完整 schema
- [ ] 新增辅助函数：
  - `settings_path(data_dir) -> PathBuf`
  - `cache_icons_dir(data_dir) -> PathBuf`
  - `cache_favicons_dir(data_dir) -> PathBuf`
  - `bookmarks_path`, `apps_path`, `local_files_path`
- [ ] `read_ai_config` / `write_ai_config` 改为读写 `settings.ai`（保留 command 名做兼容壳，内部转调）
- [ ] 对话读写不变，路径仍在 `ai/conversations/`

#### 1.3 Rust `lib.rs` 改动

- [ ] `cache_app_icon` / `cache_favicon` 缓存目录改 `{dataDir}/cache/...`
- [ ] `delete_app_icon` / `read_app_icon_data` / `delete_favicon` 校验路径必须在 cache 目录下（`canonicalize` + `starts_with`）
- [ ] `launch_v2ray` 从 settings 读 `integrations.v2ray.exePath`，硬编码值作默认
- [ ] 新增 command（可选，二选一）：
  - **方案 A**：通用 `read_data_file` / `write_data_file`（相对路径）
  - **方案 B**：typed commands `read_bookmarks` / `write_bookmarks` 等

推荐 **方案 B**（类型安全）+ 前端 repos 薄封装。

#### 1.4 新增 Rust commands（方案 B）

```
read_bookmarks / write_bookmarks
read_apps / write_apps
read_local_files / write_local_files
get_cache_dirs → { icons, favicons }
```

#### 1.5 Phase 1 验收

- [ ] `tsc` + `cargo build` 通过
- [ ] 手动 invoke 读写新路径成功
- [ ] **功能仍走旧 localStorage**（双写未开，零行为变更）

---

### Phase 2 — 一次性迁移 `migrate.ts`

#### 2.1 触发条件

启动时读 `settings.json`：
- 无 `version` 或 `version < 1` → 执行迁移
- `version >= 1` → 跳过

#### 2.2 迁移步骤（顺序固定）

```
1. 备份
   └── 复制整个 dataDir → .migration-backup-{timestamp}/

2. localStorage → 文件
   ├── orbita.bookmarks      → bookmarks.json
   ├── orbita.apps           → apps.json
   └── orbita.local.files    → local-files.json

3. localStorage → settings.ui
   ├── engine                  → ui.engineId
   ├── localTab                → ui.localTab
   └── orbita.ai.activeConversation → ui.activeConversationId

4. ai/config.json → settings.ai
   └── 若 settings.ai 为空且旧文件存在，合并后删 ai/config.json

5. 图标缓存搬迁
   ├── %APPDATA%/com.orbita.app/icons/*     → {dataDir}/cache/icons/
   ├── %APPDATA%/com.orbita.app/favicons/*  → {dataDir}/cache/favicons/
   └── 重写 bookmarks.json / apps.json 中 icon 字段为新绝对路径

6. integrations 默认值
   └── 若 integrations 缺失，填入当前硬编码路径（v2ray / zotero / obsidian）

7. 写 settings.version = 1

8. 清理 localStorage
   └── 删除已迁移 key（保留 orbita.bootstrap 供 Web 模式）

9. 校验
   ├── bookmarks.length 前后一致
   ├── apps.length 前后一致
   ├── local-files.length 前后一致
   └── list_ai_conversations 数量一致
```

#### 2.3 迁移失败

- 从 `.migration-backup-{ts}/` 还原
- `settings.version` 不写 1，下次启动重试
- 控制台 / `console.error` 输出具体步骤失败原因

#### 2.4 Phase 2 验收

- [ ] 本机跑迁移，数据条数一致
- [ ] `localStorage` 无业务 key
- [ ] `ai/config.json` 已不存在（内容在 settings.json）
- [ ] 图标仍正常显示

---

### Phase 3 — 前端仓储切换

#### 3.1 文件改动清单

| 原文件 | 动作 |
|--------|------|
| `integrations/shell/bookmarks.ts` | → `repos/bookmarks.ts`，调 `invoke read/write_bookmarks` |
| `integrations/shell/apps.ts` | → `repos/apps.ts` |
| `integrations/shell/local-files.ts` | → `repos/local-files.ts` |
| `integrations/shell/store.ts` | engine/localTab 读写 `settings.ui` |
| `integrations/shell/engines.ts` | `getDefaultEngineId` 读 settings 而非 localStorage |
| `integrations/ai/config.ts` | 读 `settings.ai`，删 `WEB_AI_CONFIG_KEY` |
| `integrations/ai/conversations.ts` | activeId 走 settings.ui；对话文件逻辑不变 |
| `core/settings.ts` | 瘦身为 re-export `core/data/settings.ts` 或删除合并 |

#### 3.2 调用方更新

- [ ] `view.ts` — import 路径改 repos
- [ ] `local-panel.ts` — import local-files repo
- [ ] `panel.ts` / `settings-dialog.ts` (ai) — config 来源改 settings

#### 3.3 Web 模式

`core/data/client.ts` 实现：

```ts
// Web: localStorage key = `orbita.data.${relativePath}`
// 例: orbita.data.bookmarks.json
```

#### 3.4 Phase 3 验收

- [ ] Tauri `dev.bat` 全功能手测（§8）
- [ ] `dev-web.bat` 全功能手测（允许 IPC 降级提示）
- [ ] 修改 dataDir 指向新空目录 → 默认值；指回旧目录 → 数据完整

---

### Phase 4 — 设置 UI 扩展

#### 4.1 `settings-dialog.ts` 新增字段

| 字段 | 类型 | 默认 |
|------|------|------|
| v2ray 程序路径 | 文件选择 | 空（首次在设置中配置） |
| Zotero 数据目录 | 文件夹选择 | 空 |
| 文献笔记目录 | 文件夹选择 | 空 |

#### 4.2 Rust 侧

- [ ] `zotero.rs` 删除 `const ZOTERO_DATA_DIR` / `ARTICLE_NOTE_DIR`
- [ ] `list_zotero_items` 从 settings 读路径（通过 `AppHandle` 加载 settings）
- [ ] `lib.rs` 删除 `const V2RAY_PATH`

#### 4.3 Phase 4 验收

- [ ] 设置里改 Zotero 路径后文献 Tab 仍正常
- [ ] 改 v2ray 路径后按钮仍正常
- [ ] 不填新字段时用默认值，行为与现在一致

---

### Phase 5 — 架构清理 + 技术债

#### 5.1 `local-panel.ts` Tab 泄漏修复

```
mountLocalPanel()
  ├── promptEntry = mountLocalEntryDialog(root)   // 只建一次
  └── renderContent()
        ├── tab=file  → mountFileList(..., { signal })
        └── tab≠file  → controller.abort()        // 卸 document/window 监听

mountFileList 内所有 addEventListener 传 { signal }
```

#### 5.2 XSS 统一

| 文件 | 改动 |
|------|------|
| `tiles.ts` `renderTile` | `escHtml(name)`, `escAttr(id)`, `escAttr(attrs.*)` |
| `local-panel.ts` `renderFileRow` | 全字段 `escHtml` / `escAttr` |
| `ai/settings-dialog.ts` | `data-model` 用 `escAttr` |
| `ai/panel.ts` | 删本地 `escapeHtml`，改 import `core/html` |
| `local-panel.ts` | 删本地 `escHtml`，改 import `core/html` |

#### 5.3 Dialog 去重（可选，本 phase）

抽 `core/dialog-factory.ts`：

```ts
createFormDialog(root, { title, fields, onSubmit })
```

`dialog.ts` 五个 mount 函数内部调 factory，**外部 API 不变**。

#### 5.4 AI 插件化

| 文件 | 动作 |
|------|------|
| `integrations/ai/index.ts` | 新建，`export const aiIntegration` |
| `main.ts` | `registerIntegration(aiIntegration)` |
| `integrations/shell/view.ts` | 删除 `mountAiPanel` 调用 |
| `integrations/ai/index.ts` `init()` | `mountAiPanel(shellBody, root)` |

#### 5.5 其他清理

- [ ] 删 `core/optimistic.ts`（无引用）
- [ ] Rust `conversation_path`：拒绝非 UUID 格式 id
- [x] 版本号统一：`package.json` / `tauri.conf.json` / `Cargo.toml` → `0.0.9`（三处一致）

#### 5.6 Phase 5 验收

- [ ] 本地 Tab 切换 20 次，Escape/添加菜单行为正常
- [ ] 书签名 `<test>` 显示为文本
- [ ] AI 面板仍正常挂载

---

### Phase 6 — 收尾

- [ ] 删除废弃代码路径（旧 `ai/config.json` 读写、localStorage 回退分支）
- [ ] `HANDOFF.md` 数据章节同步（数据路径表、schema）
- [ ] 全量手测 §8
- [ ] `roadmap.md` 本文件顶部标记 **已完成阶段**

---

## 5. 文件变更总表

### 新建

```
core/data/types.ts
core/data/paths.ts
core/data/client.ts
core/data/settings.ts
core/data/migrate.ts
core/html.ts
core/mount.ts
integrations/shell/repos/bookmarks.ts
integrations/shell/repos/apps.ts
integrations/shell/repos/local-files.ts
integrations/ai/index.ts
```

### 大改

```
src-tauri/src/data.rs
src-tauri/src/lib.rs
src-tauri/src/zotero.rs
src/main.ts
integrations/shell/view.ts
integrations/shell/local-panel.ts
integrations/shell/settings-dialog.ts
integrations/shell/store.ts
integrations/ai/config.ts
integrations/ai/conversations.ts
integrations/shell/tiles.ts
```

### 删除 / 合并

```
core/optimistic.ts                    → 删除
core/settings.ts                      → 合并进 core/data/settings.ts
integrations/shell/bookmarks.ts         → 迁至 repos/（原路径 re-export 或删）
integrations/shell/apps.ts            → 同上
integrations/shell/local-files.ts     → 同上
{dataDir}/ai/config.json              → 迁移后删除
```

---

## 6. Rust Command 变更

### 保留（行为变）

| Command | 变更 |
|---------|------|
| `read_settings` / `write_settings` | schema 扩展 |
| `read_ai_config` / `write_ai_config` | 读写 settings.ai |
| `cache_app_icon` / `cache_favicon` | 缓存目录改 dataDir |
| `delete_app_icon` / `read_app_icon_data` / `delete_favicon` | 路径白名单 |
| `launch_v2ray` | 读 settings |
| `list_zotero_items` | 读 settings 路径 |

### 新增

| Command | 说明 |
|---------|------|
| `read_bookmarks` / `write_bookmarks` | |
| `read_apps` / `write_apps` | |
| `read_local_files` / `write_local_files` | |
| `run_migration` | 可选：迁移放 Rust 侧原子执行 |

### 不新增功能型 command

本 roadmap 不引入新业务能力（滴答清单等）。

---

## 7. 风险与对策

| 风险 | 对策 |
|------|------|
| 迁移丢数据 | 自动备份 + 条数校验 + 失败不升 version |
| 图标路径失效 | 迁移重写路径 + 启动 `syncMissing*Icons` 补抓 |
| 改 dataDir 丢数据 | UI 提示：选已有目录或手动复制文件夹 |
| Web/Tauri 行为分叉 | `core/data/client.ts` 单入口 |
| 范围膨胀 | 严格按 Phase 交付，不加新功能 |

---

## 8. 全量手测清单

每完成一个 Phase 回归勾选：

### 书签
- [ ] 添加（名称+URL）
- [ ] 编辑（改 URL 后 favicon 更新）
- [ ] 右键删除模式 → 确认删除
- [ ] 拖拽排序 + FLIP 动画
- [ ] 点击打开 URL
- [ ] 启动后 favicon 显示

### 应用
- [ ] 添加（文件框选 exe/lnk）
- [ ] 编辑（改路径后图标更新）
- [ ] 右键删除
- [ ] 拖拽排序
- [ ] 点击启动
- [ ] 图标显示

### 本地
- [ ] 文件 Tab：添加文件/文件夹、打开、删除
- [ ] 添加菜单不被裁切、上下定位正确
- [ ] Tab 切换 20 次无异常
- [ ] 文献 Tab：列表、刷新、跳 Zotero、跳 Obsidian 笔记
- [ ] 笔记 Tab：占位不变

### 顶部
- [ ] 搜索引擎切换
- [ ] 当前引擎二次点击开首页
- [ ] 搜索关键词 / URL
- [ ] 时钟显示
- [ ] v2ray 按钮
- [ ] 主题切换

### 设置
- [ ] 改主题立即生效
- [ ] 改 dataDir 后数据完整
- [ ] 改 v2ray / Zotero / 笔记路径后对应功能正常

### AI
- [ ] 新对话、发送、流式输出、停止
- [ ] 切换对话、重命名、删除
- [ ] 模型切换、API 设置保存
- [ ] 对话 Prompt

### 迁移专项
- [ ] 迁移前数据 → 迁移后条数一致
- [ ] 迁移可重复执行（已 version=1 则跳过）
- [ ] 备份目录可手动还原

---

## 9. 附录：技术债人话版

| 问题 | 人话 | 对应 Phase |
|------|------|------------|
| Tab 泄漏 | 切 Tab 重复绑事件，越用越卡 | 5.1 |
| XSS | 恶意名称当 HTML 执行 | 5.2 |
| 硬编码路径 | 换电脑要改源码 | 4 |
| 数据分裂 | 一半浏览器缓存一半文件夹 | 2, 3 |
| Dialog 复制粘贴 | 五个弹窗同一套抄五遍 | 5.3 |
| 图标不在 dataDir | 备份要拷两处 | 1, 2 |
| AI 未插件化 | 说模块化实际焊在 shell | 5.4 |
| optimistic 死代码 | 写了没人用 | 5.5 |
| 版本号不一致 | 搞不清当前版本 | 5.5 |
| CSP 为空 | WebView 无内容安全策略 | **不在本 roadmap** |
| 无自动化测试 | 靠手点 | §8 手测清单 |

---

## 10. 执行顺序

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6
 基线        数据层       迁移        仓储切换     设置UI       技术债       收尾
```

**下一步**：从 Phase 1 开始写代码。

# Legacy 覆盖审计

> 审计 `docs_legacy/HANDOFF.md` §25 与 v0.0.14–0.0.17 specs；只判断现行 docs 的覆盖，历史原文不改。

## 结论

`CURRENT`、`SYSTEM`、`DEV`、`HISTORY` 与 `decisions/*` 已覆盖 0.0.17 的关键运行风险。Finance 的可执行规格已迁入 `specs/orbita-finance.md`；Journal/Health 的稳定数据契约已迁入 `specs/orbita-journal-health.md`。新 docs 已不以 legacy 作为日常实现的必要前提；legacy 保留为历史证据和逐条追溯来源。

### 本次审计处理结果

1. Finance 规格与 plan/状态/决策的断链已修复：`specs/orbita-finance.md` 现为现行可执行规格；后续须在每次大改时同步它。
2. plan 已改为链接 `DECISIONS.md`，不再指向不存在的 CURRENT 决策表。
3. 现行术语已统一为 Glossary 所定义的名称；Journal/Health 最小可执行契约已迁出至 `specs/orbita-journal-health.md`。
4. 旧 release 的 build/cargo/checklist 是历史记录，不能覆盖当前“未经允许不 build/cargo check”的 AI 规则。

## 覆盖矩阵

| 版本/主题 | 仍有效、应有现行落点 | 现状与遗漏 | 历史保留/冲突 |
| --- | --- | --- | --- |
| HANDOFF §25.0–.19 / v0.0.14 | Journal 年文件、kind/覆盖/时间语义、daily merge meals；Garmin 同步与 Agent 确认 | Garmin SSO、归日、daily merge 在 SYSTEM/DEV/integrations；Journal schema、字段映射、原始文件/command 契约已在 `specs/orbita-journal-health.md`。 | 五大区 ASCII、旧 UI、机器/账号资料留 legacy。早期自动清 token 等尝试已被现行禁令否决。 |
| HANDOFF §25.0.20–.28 / v0.0.15 | 主题 schema、唤醒、树/网格、TickTick undo、设置行为 | wake/交互/TickTick 核心护栏已迁；themePrefs/glassTint、工作 MVP、设置 schema 未列为 0.0.17 snapshot 的活动范围，保留历史，后续变更须先立计划。 | 旧 build release gate 不迁；旧 UI 细节不自动成为当前需求。 |
| HANDOFF §25.0.29 / v0.0.16 | modal root/click-through；FLIP 不回退；TickTick 改名/兼容；技术债真实状态 | modal、wake、两类拖拽与 TickTick 行为已迁；today 局部刷新、AI cache、privacy、defaults/data.rs/createDataStore 未纳入 0.0.17 snapshot 的承诺，不以旧 checkbox 推断其现状。 | 旧 Phase 1 checkbox 与 build/cargo gate 只能作历史；未做项须另立后续 plan。 |
| HANDOFF §25.0.30–.42 / v0.0.17 | Panel/Insight 双窗口、frame、hide/reuse、dataDir、Finance Service、1420 | 核心已在 CURRENT/plan/SYSTEM/decisions/DEV；需全量术语清理与手验，`[x]` 不等于已人工验收 | 旧 admin destroy、系统 chrome、固定 8000、启动即拉 Python、lifeRoot 等已被后续记录替代，保留原文但不得恢复。 |
| v0.0.17-ledger A/C/D/F/H/I/II | Finance 产品边界、`{dataDir}/bill`、Service/Parser/Commit、API、bean 不变量、数据模型、Agent 写入边界 | 已迁入 `specs/orbita-finance.md`；后续仅需随实现和手验同步。 | 不复制 BKeasy 可见产品、lifeRoot、固定端口、app-boot sidecar、旧目录布局。 |
| v0.0.17-ledger B/E/G | Dashboard→stats/detail/import；detail 编辑/同日拖拽/保存；分期、手验 | Dashboard、交互/状态机/API 已纳入 Finance spec；plan 保留手验与未做项。 | 六 tab 平铺、iframe、移动端、旧工期/完成勾选为历史；分类/账户/CSV 不可伪装已实现。 |

## HANDOFF 早期章节的定向结论

### 版本收官记录（0.0.1–0.0.13）

这些版本的原始完成记录只在 HANDOFF 中，不应改写为现行承诺。下表逐版确认其仍有效部分的去向；未列出的 UI 细节或当时的环境/版本记录保留历史。

| 版本 | 历史完成主题 | 仍有效的现行落点 / 结论 |
| --- | --- | --- |
| 0.0.1 | Tauri/Vite 壳、搜索、主题、v2ray | 运行与外部协议边界在 `decisions/runtime.md`。 |
| 0.0.2 | 启动器三栏与初始网格 | 后续网格方案已被替换；不迁为现行 spec。 |
| 0.0.3 | capabilities、确认弹窗、文件选择 | capability / modal / picker 护栏在 `decisions/surfaces.md`、`compatibility.md`。 |
| 0.0.4 | Zotero/Obsidian、异步 picker | immutable SQLite、子笔记 key、spawn_blocking 在 `compatibility.md`。 |
| 0.0.5 | 图标缓存、Pointer+FLIP | data URL 图标在 `compatibility.md`；拖拽不回退在 `surfaces.md`。 |
| 0.0.6 | AI、多对话、motion | AI 确认/流式在 `integrations.md`；弹层生命周期在 `surfaces.md`。 |
| 0.0.7 | dataDir/core-data 重构 | 当前数据根与迁移规则在 `SYSTEM.md`、`decisions/data.md`。 |
| 0.0.8 | 本地树与拖拽 | 当前仅保留不可与 tile grid 合并的护栏；交互细节属历史。 |
| 0.0.9 | grid schema、favicon、Obsidian | grid/图标兼容保留；旧布局与数值不作当前承诺。 |
| 0.0.10 | TickTick、LHM 温度 | TickTick 规则在 `integrations.md`；LHM 否决在 `HISTORY.md`。 |
| 0.0.11 | Everything、性能、图标 | 可维护兼容项在 `compatibility.md`；性能旧完成记录不替代当前验收。 |
| 0.0.12 | click-through、wake、字体 | click-through 在 `surfaces.md`，wake 在 `runtime.md`。 |
| 0.0.13 | 后续历史入口 | 具体实现由 §25 起的 0.0.14–0.0.17 记录接续；不单列新现行 spec。 |

| legacy | 结论 |
| --- | --- |
| §1–4 | dataDir/core-data、禁止业务直写 localStorage、adapter 双路径、motion 接入仍可能有效；应随代码核实后压缩到 SYSTEM/DECISIONS，不能整节搬运。 |
| §17–20 | DOM+FLIP/body ghost、网格与本地树不可合并已迁。local tree 的“指示线+松手提交”、深层/跨父级回归、grid schema 解耦仍无现行回归入口。 |
| §21–24 | LHM 温度否决、data URL 图标、wake/click-through、dataDir 不迁移已迁核心。Everything/local tab、字体、回收站/右键、设置 schema 先按代码决定是否仍维护。 |
| §5–6、§12–16 | 机器路径、账号、绝对位置、安装历史、原始对话一律留 legacy；公开 docs 只保留可复现流程和环境变量名。 |

## 重大事故/否决的覆盖确认

| 证据 | 现行归宿 | 状态 |
| --- | --- | --- |
| Garmin SSO 封禁 §25.0.13–.14 | integrations、DEV、HISTORY | 已迁：同步零 SSO、token 是资产、429 停止。 |
| Dialog/click-through §25.0.11/.29 | surfaces、DEV、HISTORY | 已迁：modal root、单例、hidden、强制可交互。 |
| 拖拽虚拟位移/统一实现 §17/.22 | surfaces、DEV、HISTORY | 已迁核心；local tree 回归细节缺。 |
| LHM 温度 §21 | HISTORY | 已迁。 |
| sidecar 吞错/端口收养/只 reconnect §25.0.31/.32/.36/.40 | finance、DEV、HISTORY、Finance spec | 已迁；规格已列出具体生命周期、API 与回归。 |
| dataDir 静默迁移/单窗口事件 §25.0.39 | data、SYSTEM、HISTORY | 已迁。 |
| admin/frame/图标 §25.0.34–.41、1420 §25.0.42 | surfaces/runtime/DEV/plan | 已迁，待真实手验。 |

## 审计边界与后续门槛

本轮不把旧版本已勾选的功能重新宣告为当前已验收：代码或行为需要改动时，以 `CURRENT`、当前 plan、相关 spec 与实机验证为准。theme/settings、launcher/local 等未在本 snapshot 收束范围内的历史项，只有在后续明确维护时才建立短规格与回归；否则仅保留 legacy 记录。

任何后续文档变更仍须检查：现行 docs 不把 legacy 当唯一规格、不留下失效链接、不把历史名称当当前产品名，也不包含私密内容。

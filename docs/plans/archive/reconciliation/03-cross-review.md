# 0.0.17 交叉审阅：计划谱系与 Insight 实际架构

> **取证快照**：2026-08-29；AccountSelect 等条目可能已过时。现行事实以 [`CURRENT.md`](../../../CURRENT.md) 与 [`v0.0.17-closeout.md`](../../v0.0.17-closeout.md) 为准。

> **性质**：临时交叉取证。本文只整理文档关系与静态代码事实，不改变正式事实源、计划状态、归档位置或验收结论。
>
> **取证范围**：`AGENTS.md`、`docs/README.md`、`GLOSSARY.md`、`CURRENT.md`、`DECISIONS.md`、`SYSTEM.md`、相关 plans / decisions / ADR、`01-plan-lineage.md`、`02-insight-actual-architecture.md`，以及 Insight Host、Finance destination 与 Rust 窗口代码的静态阅读。未运行任何动态命令。

## 1. 审阅准则

`docs/README.md` 已将当前事实、术语、稳定系统边界、不可回退护栏、取舍过程、领域契约和计划清单分别交给 `CURRENT.md`、`GLOSSARY.md`、`SYSTEM.md`、`decisions/`、`adr/`、`specs/` 与 `plans/`。因此临时收束文档只能承担**导航、谱系、去重与迁移清单**，不能复制或取代这些真源。

## 2. 对两份暂存账本的交叉结论

### 已证实

- `v0.0.17.md` 的 §1–24 是早期沟通过程；§25 仍被 README、Finance spec 与 UI 执行计划称为已确认的产品/数据逻辑来源。因此不能把整份文件简单判为旧稿。
- `v0.0.17-snapshot.md` 与 Finance 工作台计划是并行而非上下级的收束线：前者覆盖双窗口、sidecar、dataDir 与文档收束，后者覆盖 Finance 工作台。
- `finance-rebuild` 是已停止的“新壳 + 旧 Detail”失败路线；`finance-time-drag-repair` 的拖拽路线已由 `finance-chronological-order` 与 ADR 0002 替代；`finance-shell-responsiveness` 的旧执行步骤已由 `finance-workspace-redesign` 替代，但其 §1.5 仍被作为决策来源。
- 实际应用是一个 Tauri 进程、`main` 与 `admin` 两个 webview。`admin` 使用 frameless 窗口，关闭时隐藏并复用；开发构建每次重开 reload，发布构建仅在隐藏满 180 秒后 reload。
- Insight Host 以模块级 destination cache 管理四个 root。常规切换为保存恢复状态、deactivate、隐藏、首次 mount/restore、显示、activate；非活动 root 使用 `display: none`，常规切换不 dispose。dataDir 变更才经 `canDispose`、dispose、清空 cache 与 generation 变化后重建。
- 实际 destination ID 是 `health | journal | finance | work`；Health、Journal、Work 目前是 placeholder；Finance 是独立 Ledger destination。Host 不拥有 Finance Store、Commit 或内部页面路由。
- `admin/main.ts` 不等待 `ensure_ledger_sidecar`；Finance 自己处理连接、loading、error 与脏状态 guard。设置入口位于 Host titlebar，并通过 guard、设置持久化、sidecar 重启和跨窗口通知处理 dataDir 变更。

### 需要收紧的表述

- Insight Host 的“首次可见不依赖 Finance”只能表述为“不等待 Finance sidecar”，不能省略其仍会等待自身设置初始化。
- Host context 是共享的 live context；Finance 通过绑定 generation 对抗旧异步写回，不能泛称为完全不可变 snapshot。
- “Insight 是 dataDir 的唯一入口”是已定案产品边界并能在 admin 实现中看到；仅凭本次代码范围不能穷尽反证其他窗口不存在另一个入口。
- `v0.0.17-insight-spec.md` 的“收官”只覆盖 Host 与其既有自动化回归，绝不扩及 Finance 内部 UI。
- `v0.0.17-architecture.md` 应称为“未见明确取消或替代的未实施蓝图”，不能写成现行真源。

### 仍需后续迁移前才能判定的事项

- 静态文本无法证明 `v0.0.17.md` §25 的每一条稳定契约均已迁入 `specs/`、`decisions/` 或 `SYSTEM.md`。
- `finance-shell-responsiveness` §1.5 仍被引用，不能假定其长期决策已经迁移完成。
- 静态阅读不能证明窗口、任务栏、overlay 等真实运行行为；本文不把这些列入验收判断。

## 3. 推荐的临时收束信息架构

临时层可合并为一份后续协调地图（建议名称：`0.0.17-closeout-map.md`），仅包含：

1. 文档职责与真源链接；
2. 计划谱系、替代关系与尚未迁移的依赖；
3. 一张简短 Insight 实际架构图与代码索引；
4. 下文四类清单；
5. 正式文档收束前必须完成的“迁移真源 / 更新引用”清单。

它不能替代下列文件：

- `CURRENT.md`：真实当前状态；
- `GLOSSARY.md`：现行术语；
- `SYSTEM.md`：系统边界；
- `decisions/`：窗口、dataDir、运行时与交互护栏；
- `specs/` 与仍被引用的 Finance spec：领域契约；
- `adr/`：取舍记录；
- 仍在进行的计划：任务清单与后续工作。

## 4. 四类清单（不评价验收充分性）

### 已完成且不再作为后续实现输入

- Insight Host 基础：自绘 chrome、四个 destination root、缓存切换、常规切换不 dispose，以及 dataDir 变更时 dispose/recreate。
- “第二应用”、Web/NAS/手机端、空 Home、动态 workspace、跨窗口领域同步与缓存淘汰：都不是 0.0.17 当前已采用范围。
- Finance “新壳 + 旧 Detail”路线。
- 同日拖拽路线。
- shell-responsiveness 中已被 workspace redesign 覆盖的旧执行步骤。

### 未做且不再作为 0.0.17 范围

- Health、Journal、Work 的领域业务实现（当前仅 placeholder）。
- Conversation、Context、Relation、跨领域首页与万能 Event 模型。
- `archiveRoot` 配置字段、自动拆分数据根与自动迁移。
- 时间/拖拽修补计划中尚未完成的拖拽项。

### 未做但仍需作为后续工作或明确转交

- snapshot 线中的窗口、sidecar、dataDir 与开发收束事项。
- Finance UI 与 workspace redesign 的进行中事项。
- chronological order / CSV 的后续事项。
- 未开始的 AccountSelect 专项计划。
- 将 §25 和仍留在旧计划的稳定契约逐条迁入正式真源，并更新所有现行引用。

### 仍为现行基础或决策来源

- 单 Tauri 应用、main/admin 双窗口、隐藏复用、frameless admin 窗口、非阻塞 ensure sidecar。
- Host 只拥有导航、root、共享 chrome/modal 与生命周期；领域自己拥有业务，Finance 自己拥有 Store/Commit。
- `dataDir` 共同根、Insight 设置入口、不得自动迁移、跨窗口通知与 sidecar 重启。
- Finance 数据/写入安全契约、ADR 0002 与 ADR 0003。
- `v0.0.17.md` §25、`v0.0.17-spec.md`、`v0.0.17-finance-ui-execution.md` 与 `v0.0.17-finance-workspace-redesign.md` 在其明确职责内仍是现行来源。

## 5. 结论

当前最需要的不是把所有资料压缩为新的规格，而是先把“历史过程、现行基础、被替代路线、后续工作和待迁移契约”分开。`01`、`02` 与本文可在后续人工确认后被压缩为一份**非规范性收束地图**；正式真源仍按 README 的职责分层保留。

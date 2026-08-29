# 0.0.17 计划谱系（临时只读汇总）

> **取证快照**：2026-08-29；AccountSelect 等条目可能已过时。现行事实以 [`CURRENT.md`](../../../CURRENT.md) 与 [`v0.0.17-closeout.md`](../../v0.0.17-closeout.md) 为准。

> 范围：仅根据 `docs/README.md`、`GLOSSARY.md`、`CURRENT.md`、`DECISIONS.md`、`SYSTEM.md` 和 `docs/plans/` 的现有文本整理。
>
> 本文**不评价任何验收是否充分**，也不更改计划状态、文件位置或事实来源；“完成 / 未做”仅转述各计划与 `CURRENT.md` 的明示状态。

## 读法与归档边界

- `docs/README.md` 将 `plans/` 定义为当前范围与验收，`plans/archive/` 定义为已收官、取消或被替代计划的追溯位置；计划归档须保留真实 checkbox 和 `Outcome`，并写清状态、基线、交付、未完成去向和后续链接。
- 稳定的系统、术语和长期护栏分别由 `SYSTEM.md`、`GLOSSARY.md`、`DECISIONS.md` 承担；计划不应替代这些职责。
- 本文的“现行”是**当前文本仍将该文件称为依据或仍有未收官项**，不是对实现完成度的判断。

## 谱系总览

```text
v0.0.17.md §25（已确认 Finance 产品/数据逻辑来源）
 ├─ v0.0.17-architecture（早期实施蓝图；设计中）
 ├─ v0.0.17-spec（数据 / Parser / Commit / Service 基础）
 └─ v0.0.17-insight-spec（Insight Host 宿主契约；文本称已收官）
       └─ v0.0.17-finance-ui-execution（唯一 UI 执行依据；进行中）
             ├─ finance-rebuild（失败路线，停止）
             ├─ finance-time-drag-repair（拖拽路线被替代）
             ├─ finance-chronological-order（替代拖拽；仍有待验项）
             └─ finance-shell-responsiveness §1.5（工作台决策来源）
                   └─ finance-workspace-redesign（当前工作台执行计划；进行中）
                         └─ finance-account-select（未开始的专项计划）

v0.0.17-snapshot（并行的窗口 / sidecar / dataDir / 文档收束计划；进行中）
```

## 逐份计划

| 计划 | 文本状态 / 分类 | 前后关系与关键证据 |
| --- | --- | --- |
| `v0.0.17.md` | 混合：§1–24 是早期沟通历史；§25 仍为现行产品逻辑来源。 | 文件开头称其负责 Finance 功能、确认契约、Parser/Commit 边界与架构验收；§25 写明后续整理应拆回具体章节。`README.md`、`v0.0.17-spec.md` 和 `v0.0.17-finance-ui-execution.md` 都明确将 §25 称为已确认逻辑真源。因此不能把整份文件简单等同于可归档的旧讨论。 |
| `v0.0.17-architecture.md` | 未做：文件明示“设计中；尚未开始实现”。 | 由 `v0.0.17.md` §25 派生为模块、状态和 API 边界；文件称与早期章节冲突时以 §25 为准。未见其文本明示被取消或替代；是否继续作为路线，应由后续计划状态决定。 |
| `v0.0.17-spec.md` | 现行基础：数据、Parser、Candidate Commit、sidecar 与 Host 集成已是基础，本轮不重做。 | 自身将 UI 执行权交给 `finance-ui-execution`，但保留数据与安全写入边界；并指明 §25 为权威来源。`SYSTEM.md` §4 也将 Finance 现行细节指向 `decisions/finance.md` 与 `specs/orbita-finance.md`，显示稳定契约已部分迁至 plans 外。 |
| `v0.0.17-insight-spec.md` | 完成：文本称 Host 实现与既有自动化回归已收官；不涵盖 Finance 内部 UI。 | 是 Finance 重建的上层宿主契约；明确 Finance 数据/Commit 见 `spec`、内部 UI 见 `finance-ui-execution`。`CURRENT.md` 将 Insight Host 重构列为“已收官”。 |
| `v0.0.17-finance-rebuild.md` | 未做且不再做：已停止作为执行规格，保留失败路线。 | 文件明确唯一执行依据改为 `finance-ui-execution`；不得以“新壳 + 旧 Detail”继续实现。其证据性/防回退价值与 `DECISIONS.md` 的“已定案护栏不应随意恢复”规则一致。 |
| `v0.0.17-finance-ui-execution.md` | 现行、进行中：自身称“Finance UI 的唯一执行依据”。 | 上游遵循 §25、`spec` 与 `insight-spec`；下游记录 `finance-rebuild` 为失败路线、时间排序改用 `finance-chronological-order`。阶段 C/D 有 `[-]`/`[ ]` 项；这只是其文本状态，不在本文判断验收。 |
| `v0.0.17-finance-time-drag-repair.md` | 未做且不再做（限拖拽路线）：时间链路已落地，拖拽路线已被替代。 | 文件明示被 `finance-chronological-order` 与 ADR 0002 取代，历史验收仅作记录；`CURRENT.md` 同样称原拖拽部分已作废。 |
| `v0.0.17-finance-chronological-order.md` | 部分完成 / 仍有待做：自动化验证已完成，真实 Tauri 交互与 CSV 跨进程落盘仍待。 | 是时间排序对拖拽路线的替代计划，并由 ADR 0002 支撑；被 `CURRENT.md`、`finance-ui-execution`、`finance-shell-responsiveness` 继续引用。 |
| `v0.0.17-finance-shell-responsiveness.md` | 部分完成；旧实施步骤已被替代，但 §1.5 仍是工作台决策来源。 | 文件称代码与 Vitest 已落地、真实 Tauri 待用户验收；又明确“桌面筛选常驻顶栏、右栏常驻 Composer”的旧执行方案已由 `finance-workspace-redesign` 取代。`finance-workspace-redesign` 与 `UI-PRIMITIVES.md` 都引用其 §1.5 的 live decision log。 |
| `v0.0.17-finance-workspace-redesign.md` | 现行、进行中：阶段 0–3 已落，阶段 4 P0 阻塞，阶段 5/6 各有明示状态。 | 自称 Source of truth；以 `finance-shell-responsiveness` §1.5 为决策来源，并限定不改 Parser、Candidate、Commit、时间排序等上游契约。`CURRENT.md` 将 §11 细则与待验状态指向本计划。 |
| `v0.0.17-finance-account-select.md` | 未做但需做：`[ ]` 未开始。 | 专项计划以 ADR 0004 为决策来源；限制在 Finance 单选账户调用，不改多选筛选、Parser、Candidate、Commit、CSV、账本格式或 dataDir。它是工作台计划中 `AccountSelect` 原语的具体化后续。 |
| `v0.0.17-snapshot.md` | 现行、进行中：0.0.17 的并行收束计划。 | 覆盖 Insight、Finance Service、dataDir、开发保护与文档迁移；明确 Finance 全量功能和前端架构重构由 `v0.0.17.md` 承接，互不替代。`README.md` 和 `CURRENT.md` 都将其列为当前/待验入口。 |

## 可追溯的归类清单

### 当前仍作为依据或有未收官项

- `v0.0.17.md`（至少 §25）
- `v0.0.17-architecture.md`（未开始，未明示取消/替代）
- `v0.0.17-spec.md`
- `v0.0.17-finance-ui-execution.md`
- `v0.0.17-finance-chronological-order.md`
- `v0.0.17-finance-shell-responsiveness.md`（至少 §1.5）
- `v0.0.17-finance-workspace-redesign.md`
- `v0.0.17-finance-account-select.md`
- `v0.0.17-snapshot.md`

### 文本已明确完成、停止或替代

- `v0.0.17-insight-spec.md`：Host 规格文本称已收官。
- `v0.0.17-finance-rebuild.md`：失败路线，停止作为执行规格。
- `v0.0.17-finance-time-drag-repair.md`：拖拽路线已被时间排序计划与 ADR 0002 替代。

上述归类不构成移动或归档建议；任何归档操作仍应依 `docs/README.md` 逐份保留真实状态并补齐 `Outcome`。

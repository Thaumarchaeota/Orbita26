# Architecture Decision Records（ADR）

ADR 用来记录重要但尚可讨论的产品、架构和数据取舍：为什么要做选择、有哪些可行方案、选择后的影响，以及仍未解决的问题。

## 何时创建

仅在选择会长期影响至少一项内容时创建：产品语义或交互口径、模块职责、数据格式或归属、跨窗口协作、外部集成、迁移与兼容边界。普通 bug、样式和局部实现不创建 ADR。

## 决策流程

1. 实施者创建 `Proposed` ADR，写清背景、建议、代价与替代方案。
2. 项目维护者确认后，才将状态改为 `Accepted`。未确认前不得把 ADR 当作实施授权。
3. 已确认且不应被随意恢复的护栏，再用最小必要摘要同步到 `docs/decisions/`、`SYSTEM.md` 或对应 `specs/`；ADR 保留完整取舍过程。
4. 新决定替代旧决定时，将旧 ADR 标为 `Superseded`，并链接新 ADR。

## 命名与模板

文件名使用四位顺序号和简短英文主题：`NNNN-short-title.md`，例如 `0001-finance-storage-boundary.md`。从 `0001` 开始，按创建顺序递增，不因删除或替代重排编号。

```markdown
# <Title>

- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives considered

## Open questions
```

## 当前记录

| ADR | 状态 | 主题 |
| --- | --- | --- |
| [0001](0001-finance-detail-render-threshold.md) | Superseded | Finance 明细渲染阈值。 |
| [0002](0002-finance-chronological-order-without-drag.md) | Accepted | Finance 时间排序与移除拖拽。 |
| [0003](0003-perceived-responsiveness-and-durable-completion.md) | Accepted | 全局感知流畅与可信完成反馈。 |
| [0004](0004-finance-account-select-cascade-menu.md) | Accepted | Finance AccountSelect 级联菜单与全路径搜索。 |
| [0005](0005-shared-worktree-agent-collaboration.md) | Accepted | 共享工作树的 agent 协作与风险分级。 |
| [0006](0006-health-owned-meals-with-nutrition-envelope.md) | Accepted | Health 拥有 meals；nutrition 为可扩展属性（0.0.18 范围）。 |
| [0007](0007-journal-note-as-a-first-class-record.md) | Accepted | Journal note 为一等记录（0.0.18 范围）。 |
| [0008](0008-garmin-health-initial-fetch-catalog.md) | Accepted | Garmin Health 初始拉取目录（0.0.18 范围）。 |
| [0009](0009-journal-health-professional-facts-with-sync-envelope.md) | Accepted | Journal / Health 专业事实表与共享同步信封（0.0.18 范围）。 |
| [0010](0010-work-ticktick-local-projection.md) | Proposed | Work 与 TickTick 本地投影。 |
| [0011](0011-finance-multi-replica-record-coordination.md) | Proposed | Finance 多副本记录协调。 |
| [0012](0012-archive-object-connection-model.md) | Proposed | Archive Object 与 Connection 连接组模型。 |
| [0013](0013-work-schedule-domain-model.md) | Proposed | Work 与 Plan 领域模型及 TickTick 适配边界。 |
| [0014](0014-finance-v2-canonical-reconciliation.md) | Proposed | Finance v2 的 SQLite 真源与可追溯对账。 |

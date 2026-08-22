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

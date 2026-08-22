# Finance 明细渲染阈值

- Status: Superseded
- Date: 2026-08-22

> Superseded by [ADR 0002](0002-finance-chronological-order-without-drag.md) for the drag-related rationale. The 10,000-item rendering threshold remains in force pending its own performance review.

## Context

Finance 明细的虚拟列表在快速滚动时出现卡片样式延迟或长期错误。现有同日拖拽只能命中已挂载的 DOM，且尚未实现边缘自动滚动、跨屏目标命中或拖拽期间的虚拟窗口冻结；在当前 1,000/800 条阈值下，这使拖拽功能半可用且不可靠。

## Decision

将 Finance 明细保持全量连续渲染的上限提高到 10,000 条，移除 800 条回退阈值。超过 10,000 条时进入虚拟模式。时间、`seq`、候选校验和 Commit 语义不因该纯渲染策略改变；Finance 在所有数据量下均不提供拖拽排序，见 ADR 0002。

## Consequences

- 10,000 条以内需验证连续渲染的滚动和筛选性能；不能以虚拟列表掩盖布局或状态错误。
- 超过阈值仍须保持相同的时间排序、筛选和保存语义；虚拟渲染不得成为数据语义差异来源。

## Alternatives considered

- 保持 1,000/800 阈值：连续渲染已经证明在日常账本中更稳定，较低阈值会过早引入虚拟化复杂度。
- 将渲染阈值与排序语义耦合：会使相同账本因条目数量不同而出现不同交互或写入规则，未采用。

## Open questions

- 10,000 条连续渲染在真实大账本上的性能验收结果。

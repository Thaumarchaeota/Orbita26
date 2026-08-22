# Finance chronological ordering without drag

- Status: Accepted
- Date: 2026-08-22

## Context

Finance 的同日拖拽在真实界面中不可用，且与虚拟列表、pointer capture、插入提示和回弹动画耦合。时间现在可以由 CSV、Composer 和 inline 编辑写入并显示，但所有主要排序路径仍只按 `date` 和 `seq` 排序；展示端和 commit 端对 `seq` 的数值/字符串处理也不一致。

## Decision

移除 Finance 的用户拖拽重排序，保留 `seq` 仅作稳定回退。以 Transaction 的规范 `time` metadata 建立统一排序契约：日期优先、同日有效时间优先、再以数值 `seq` 和稳定来源兜底。UI 保持日期倒序，账本文件保持日期正序。

历史单个异常时间只读保留并不参与时间排序，且不阻断无关编辑的 transparent round-trip；重复 `time` 必须由候选校验阻断，防止 renderer 的按-key 收束静默丢失 metadata。CSV、Composer 和 inline 是新时间的严格校验入口；commit 仅写入以统一排序键渲染的候选文本。

同日先排列有有效时间的记录（由早到晚），再排列无有效时间的记录（按数值 `seq` 稳定回退）。本 ADR 取代 ADR 0001 中“为拖拽保留渲染阈值”的产品理由。

## Consequences

- 删除一整条不可靠的交互和其数据写入入口，但不删除历史 `seq` 或更改账本数据。
- Parser、前端、Candidate 和 Commit 必须一起改；只改任一层会造成展示与落盘重排不一致。`seq` 不落盘，而是按同日规范文件行序重建；因此它是受控文件顺序的稳定回退，而不是可独立迁移的数据字段。
- 因 Commit 全量规范化重写，token 必须绑定验证时的 write target、`account.bean`、`category.bean` 与写入目标设置的版本指纹；这些输入变化后只能 reload/revalidate，不能继续覆盖。metadata renderer 必须透明保留未知重复键，并使用 Parser 对称的字符串编码，避免排序改造扩大既有数据丢失或文本损坏风险。
- 10,000 条渲染阈值在本决策中不改变；其拖拽专属文案和禁用逻辑应在实施时删除或改写为纯性能说明。

## Alternatives considered

- 继续修复拖拽：已暴露出持久 overlay、命中测试、空白释放和真实验证缺口，风险与收益不匹配。
- 删除 `seq`，只按时间排序：无法兼容无时间历史记录、同分钟并列及 Pad/Balance。
- 仅 UI 按时间排序：保存/重载会回到不同顺序，且无法保证 candidate hash 与 commit 一致。

## Open questions

- 无。

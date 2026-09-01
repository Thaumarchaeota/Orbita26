# Work 与 Plan 领域模型及 TickTick 适配边界

- Status: Proposed
- Date: 2026-08-31

## Context

TickTick 的任务/子任务结构不足以表达 Orbita 所需的长期工作计划、Main/Branch 认知路径、实际工作过程和可重叠推进。此前 ADR 0010 把 TickTick 的 confirmed projection 作为 Work 的基础；后续设计已转向 Orbita Work 与 Plan 自己拥有本地事实，TickTick 作为可移除的外部适配器。

目标不是替换 TickTick 的提醒体验，而是使 Orbita 的 Project、Node、Session、Segment 和 PlanItem 即使关闭集成也保持完整、可同步和可回看。

## Decision

### Work Object

```text
work
├── Project
├── Node (kind: task | phase)
├── Session
└── Segment
    └── Interval（子记录，不是 Object）
```

**Project** 是工作边界与 Node Tree 容器：`title`、可选 `description`、`status = planning | active | archived`。Project 不冗余保存所有子 ID。

**Node** 是树节点，公共字段为 `projectId`、可选 `parentNodeId`、`kind`、`title`、排序值。父节点必须同属 Project，且不得指向自己或形成环；一个父节点可混合拥有 task 与 phase 子节点。

- `task` 专属：`status = todo | active | done | parked | cancelled`、`origin = planned | emergent | promoted`、可选描述与完成时间。新建时 origin 只可为 planned 或 emergent；promoted 是将既有 emergent 节点显式纳入计划的历史结果。
- `phase` 专属：`status = planning | active | done | cancelled`、可选描述及计划时间范围；不使用 parked。完成必须由用户手动触发。Phase 是分组/阶段，不是假任务。

Branch 是 `origin = emergent` 的 task Node；它不自动创建或开始 Segment，也不能隐式篡位为 Main。显式 Promote 才改变其计划地位。

**Session** 是一段真实工作时间容器，可跨 Project：可选标题、`draft | planned | active | ended | cancelled` 状态、可选计划起止、实际起止和可选最终总结。draft/planned Session 可没有 Segment；开始前至少需要一个 Segment；开始 Session 只写 Session 状态和开始时间，不自动开始任何 Segment。结束的 Session 必须有实际开始与结束时间；开始前取消的 Session 则不产生实际时间。结束时默认提供收尾记录；若有 active Segment，确认后以 Session 结束时间截断并结束它们。

**Segment** 是 Session 内一次具体推进：`sessionId`、必填 `projectId`、可选且至多一个 `nodeId`、可选计划时间、`planned | active | paused | ended | skipped` 状态、可选摘要和结果。Segment 可重叠；同一 Session 可承载不同 Project 的 Segment。修改 Segment.projectId 时，如 node 属于旧 Project，必须清空 nodeId 并要求重新选择或保留为空。Segment 可在用户明确操作时创建或更新关联的 Schedule；Schedule 不反向推导或自动创建 Segment。

**Interval** 记录一个 Segment 内连续的开始到暂停/结束；暂停关闭当前 Interval，恢复新建 Interval。Interval 可事后编辑，但不是可连接 Object。实际工作时长是 Session 内所有 Interval 的时间并集；休息为 Session 实际范围减该并集，因此重叠不重复计时。

### Work 守则

- 开始带 nodeId 的 Segment：todo 自动转 active；active 不变；done/parked/cancelled 必须确认恢复 active；nodeId 为空则不改 Node。暂停或结束 Segment 不反向改变 Node。
- 所有完成都由用户主动触发。完成 Task 或 Phase 时递归检查全部后代；存在 todo/active/parked 后代即禁止完成（起飞检查单）。
- 取消是软检查：提示后代状况，确认后只取消当前 Node，不自动级联。
- Node 只有没有 Segment、Schedule、Connection 等引用时才可物理删除；有引用时只能取消。
- Project 归档要求无 active Session 且无 todo/active Task；parked Task 可保留。

### Plan domain

Plan 是独立领域，唯一 Object type 为 PlanItem，表达一项未来意图；它可独立存在。共同字段方向是必填 `title`、可选 `description: string`、`hasDetail: 0 | 1`、`status = todo | done | cancelled`、自动 `completedAt?`、至多一个可选 `groupId` 与可选 `recurrenceId`。完成/取消由用户手动触发；有引用时只能取消，未被引用才可物理删除。`kind` 定义两种可显式转换的形态：

```text
todo      plannedTime = null | localDate | UTC datetime；列表待办，不进 Timeline，时间是拟做/提醒点而非 deadline
schedule  startAtUtc + endAtUtc；真实时间占用，进入 Timeline
```

Todo 升格为 Schedule、或 Schedule 降级为 Todo 时，保持同一 PlanItem ID、Connection、详细内容、分组和历史，只更新 kind 与相应时间字段；升格必须明确指定日期、`startAt` 与 `endAt`，降级则把原 Schedule `startAt` 保留为 Todo `plannedTime`。Schedule 可有前置和后置各最多 3 个严格连续的内部 ScheduleBlock；Block 不是 Object，可有自己的 `hasDetail`。Block 用 `side: before | after` 与可拖动排序键排序，UI 派生“前置/后置 1…3”标签，删除后自动重排；不把固定位置编号当身份。移动整个主时段时两侧 Block 整体平移；调整主时段一侧边界时，该侧 Block 随边界保持连续，另一侧仍锚定原边界。取消 PlanItem 时保留其 Block、详细内容与历史。详细内容路径由对象 id 确定为 `{archiveRoot}/details/{id}.md`：默认 `hasDetail = 0`，明确创建时写入 MD 并置为 `1`，明确删除时删除 MD 并置回 `0`；读取缺失文件时显示“详细内容缺失”，可由用户明确新建空白 MD。精确时刻使用 UTC；纯日期按全局 Business Time Zone 解释。只有 Schedule 与 Segment 存在专门强关联：Schedule 不反向推导或自动创建 Segment，只有 Segment 的明确用户操作可创建或更新关联 Schedule；与其它 Object 的上下文关联使用 Connection。

Plan Group 是随领域同步的组织元数据，不是 Archive Object；每条 PlanItem 至多一个可选 `groupId`，未来可经 `parentGroupId` 表达文件夹树。重复安排不建长期规则 Object：生成器在明确范围内创建多条同 kind 的独立 PlanItem，共享 `recurrenceId`；单条升格/降级不改变同批其他项，编辑时可选择仅本条、此后或整组。priority、Group 的完整树规则与生成算法尚未定案。

归档 Plan Group 时弹确认框，确认即可归档。删除含 PlanItem 的 Group 时弹出三个选项：取消操作；确认并取消该 Group 内的所有 PlanItem；或确认并将这些 PlanItem 移到用户选择的新 Group。已完成/取消的 PlanItem 从正常列表隐藏，但仍可在 Insight 回看；Schedule 仍保留在 Timeline 历史中。

### 本地事实同步与 TickTick

Project、Node、Session、Segment、Interval、PlanItem 等 Orbita 事实的目标是 local-first：先写各端本地 SQLite。它们将复用所有可同步 Object / data aggregate 的同一个通用 Sync Core；Interval 等 Component 随父 aggregate 原子同步，不另设 Work / Plan 同步机制。具体 transport record、事务边界与现有 outbox 的迁移仍未定案；实施前须单独设计，不能假定现有 outbox 可直接复用或联网。普通领域写入不是服务器 command。

command 只请求外部世界执行动作，例如由服务端创建、更新、完成或删除 TickTick 项。外部命令失败不得回滚已保存的 Orbita 事实。目标中 TickTick/Dida 是 Plan 的可选双向适配器：Todo 与 Schedule 均应同步所有能表达的字段，Orbita 无法映射的字段保留在本地；停用适配器不得伤害本地模型。精确字段映射、冲突和删除策略仍待单独设计；当前 TickTick 任务真源与桌面直连行为仍以现有文档为准。

本 ADR 不能自行替代 ADR 0010；若目标模型获维护者接受并完成相应实施/迁移，必须通过对 ADR 0010 的明确更新或后续 ADR 记录其治理关系。在此之前，ADR 0010 与现有桌面直连行为仍保持原状，禁止 desktop 与 server 双写 TickTick。

## Consequences

- Work 的复杂计划树与执行时间线不再受 TickTick 两层结构限制。
- PlanItem 成为跨领域的未来意图对象；Schedule 是其具体时间占用形态，而不是 Work 的附属字段或 TickTick 的镜像。
- Work/Schedule 进入本地数据、Sync Core、外部 command、冲突、恢复和隐私的 L3 范围。
- Panel 的 Project/Session 双视图、Branch Guard、Insight 事后编辑等是产品设想，不是本 ADR 的实施承诺。

## Alternatives considered

1. TickTick 任务作为 Work 真源：拒绝，无法承载独立 Work Tree、Session/Segment 和可移除集成。
2. 以 Connection 表示 Work 树：拒绝，树需要唯一父级、排序和完成语义。
3. Session 绑定唯一 Project/Task：拒绝，真实工作可在一段时间内跨项目、交错推进。
4. 长期 recurrence rule 驱动 PlanItem：暂不采用；独立 PlanItem + recurrenceId 更易单次修改、完成与同步。

## Implementation boundary and open questions

本 ADR 不授权创建数据库、同步 outbox、服务端 connector、TickTick OAuth/命令、UI 或迁移。实施需独立计划并先完成 Sync S0：replica、shadow、ACK/cursor、inbox 去重、完整 canonical snapshot、冲突、root 切换与 L3 验收。

尚未定案：TickTick 双向字段映射、命令幂等与冲突、Group 归档/排序、Schedule 生成器、Session Action 历史、子 Project、拖拽/排序 UI、Branch Guard、外部删除/恢复策略。

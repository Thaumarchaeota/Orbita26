# Archive Object 与 Connection 连接组模型

- Status: Proposed
- Date: 2026-08-31

## Context

Orbita 长期需要让 Journal、Health、Finance、Work、Plan、Travel 等独立领域的数据彼此可发现，却不能把专业事实压进万能 Event、通用 JSON 表或图数据库。此前两个跨域模型候选现已收束为一个能容纳一次就医、旅行或阶段性上下文的连接组模型。

这份 ADR 只定义目标公共语言和边界。它不改变当前 Journal/Health SQLite 专业事实、Finance `.bean` 真源、现有 TickTick 集成或任何用户数据。

## Decision

### Domain、Object 与 ArchiveRef

使用三层术语：`Domain → Object type → Object instance`。

- Domain 是逻辑所有权边界，拥有对象的真源、写入权、删除、时间和同步规则；它不是物理文件、SQLite 表或可自由填写的标签。
- Archive Object（简称 Object）是可持久化的领域事实，或稳定可引用的外部事实；Object 不共享万能 schema。Health 的餐食、午睡、活动和睡眠夜是可连接 Object；体重、体脂、水分、日汇总和高密度指标等领域数据不成为 Object。
- `ArchiveRef = { domain, type, id }` 是跨领域引用信封。`id` 是不可变 UUID，不携带领域或类型前缀；可读路径只是显示/日志形式。

Object 的公共内部元数据方向为稳定 `id`、创建/更新时间和 tombstone；各领域仍负责自己的业务字段与时间语义。

### Connection

Connection 是 Archive 公共层的 Object。它表达“这些对象属于同一段上下文或彼此有关”，而不是要求成员两两存在一条命名边。

```text
Connection
└── 0..N Member → ArchiveRef
```

- Connection 可为空，作为待整理的草稿容器。
- Connection 有必填 `title`、可选 `description` 和 `hasDetail: 0 | 1`；详细 MD 固定按 Connection ID 定位。
- Connection 可包含任意 Object，也可包含另一个 Connection。
- 嵌套必须禁止直接和间接环；读取可递归展开，但实现应保留有限深度和循环诊断。
- Member 概念上从属 Connection；关系数据库可用 `connection` 与 `connection_member` 两表实现。Member 保存 `connectionId`、`memberDomain`、`memberType`、`memberId` 和可选无行为 `kind`；同一 Connection 内 `(connectionId, memberDomain, memberType, memberId)` 唯一。
- Connection 与 Member 都不复制领域 payload，不接管成员真源，也不让成员保存反向 ID；读取关联时由 ArchiveRef 反查。
- 成员软删后保留 Member 引用并显示“已删除”。`kind` 不是第一版强制字段，也没有行为。成员数或出现多个交易并不自动把底层事实改写为付款关系；领域 UI 可以基于上下文提供解释。

### Connection 不是专门关系的替代物

当关系有明确、受约束且会影响行为或统计的领域语义，使用专门字段/关联：

- Work Node 的 `parentNodeId` 形成计划树；
- Segment 的 `projectId` 与可选 `nodeId` 表示推进归属；
- `PlanItem.kind = schedule` 与 Segment 的计划/执行关联（Schedule 不反向推导或自动创建 Segment；仅 Segment 的明确用户操作可创建或更新关联 Schedule）；
- 未来外部适配器的稳定映射。

Connection 只承载其余跨域上下文，例如一次就医连接 Schedule、Journal Entry、交易和相关对象。

### Journal 的目标 Object 分类

目标 `journal/entry` 是 Journal 唯一的 Object type，`kind` 为 `note | document`：Note 是短文字且可有 mood、`hasDetail = 0`；Document 也可有 mood、摘要和一份对象专属 MD 详细内容、`hasDetail = 1`。Entry 的 `startedAt` 必填、`endedAt` 可选。

此分类是未来迁移目标。当前 `events`、`moods`、`notes` 专业事实表，以及 ADR 0007、0009 的已接受边界继续有效，直到独立迁移计划、兼容设计和真实验收完成。

### Timeline 与兼容性

Timeline 是跨领域查询/阅读模型，不是 Object、Connection 的替代品或万能事实表。它读取领域时间语义并可展示 Connection 上下文；pending command 不得显示为已发生事实。

未来对象存储需支持兼容性诊断：未知 Object type 保留且只读；已知类型包含未知字段时提示编辑可能丢失字段，并阻止会重写 payload 的操作，除非用户明确确认风险。

## Consequences

- 各领域可彼此引用而保持独立真源和专业约束。
- 此前并列的跨域候选不再作为产品模型；Connection 连接组成为共同设计语言。
- Connection、Journal Entry 与稳定 ArchiveRef 需要新的本地 schema、迁移、同步契约和 L3 验收，不能由当前 `sync_outbox` 或 JSON payload 直接推导。实现时 Connection 是本地 SQLite aggregate 根，Connection Member 随其原子同步，并复用所有可同步 Object 的通用 Sync Core。
- 任何 Connection 的自动建议都必须保留来源/证据并等待用户确认；AI 推断不成为 Archive 事实。

## Alternatives considered

1. 万能 Event 表：拒绝，会抹平交易、睡眠、任务和文档的领域语义。
2. 仅二元关系：拒绝作为第一模型，无法自然表达一次旅行或就医等多对象上下文。
3. 只采用自由上下文文本：拒绝，缺少稳定成员引用、反查和嵌套边界。
4. 立即采用图数据库：拒绝，当前没有验证收益，也不替代领域存储。

## Migration and implementation boundary

本 ADR 不授权修改 schema、迁移 Journal、创建 Connection 表、同步 Connection，或改变现有 UI。实现前必须建立独立计划，明确 stable ID 覆盖范围、旧数据策略、数据根、事务 outbox、删除/恢复、嵌套环检查、跨端冲突、兼容诊断与人工验收。

## Open questions

- Connection 的来源、证据、状态、时间锚点及 `kind` 的具体语义。
- 删除/恢复 Connection 本体、嵌套读取最大深度与性能策略。
- Entry 标题与当前 Journal 的迁移方式。详细内容已定为 `hasDetail` + `{archiveRoot}/details/{id}.md`；MD 同步/备份与编辑冲突规则仍开放。
- Travel、Media、Knowledge 的对象类型与外部引用策略。

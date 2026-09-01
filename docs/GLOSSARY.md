# Orbita 名称与术语契约

> **状态**：现行产品术语；Archive Object、Connection、Work 与 Plan 的目标术语仍为 Proposed 设计，尚未代表当前实现。
> **用途**：统一产品、界面、数据领域与技术组件的称呼，避免同一个词同时指 UI、数据、服务或历史项目。  
> **不做**：本文件不触发代码目录、command、配置字段或用户数据的重命名；这些变更必须另开计划。

## 1. 总规则

1. 先说明所处层级，再使用名称：界面、领域、数据、服务与存储不得混称。
2. `Orbita` 是应用总名；正式产品/领域名称可带 `Orbita` 前缀，日常同一语境中可省略。
3. UI 说用户看见的名称；领域说业务与数据；技术文档再说实现组件。
4. 不再使用“前台 / 后台”描述产品界面：它们容易分别与前端、后端混淆。
5. 不再使用 `LifeData` 作为现行概念；它已废弃。

## 2. 产品与界面层

```text
Orbita
├── Orbita Panel
└── Orbita Insight
```

| 正式名称 | 简称 | 指代 | 旧称 / 禁用说法 |
| --- | --- | --- | --- |
| **Orbita** | Orbita | 整个桌面应用与产品。 | Orbita + LifeData 双应用。 |
| **Orbita Panel** | Panel | 原前台：日常进入、今日查看、快速记录、轻量操作的主界面。 | 前台、主前端。 |
| **Orbita Insight** | Insight | 原后台/台后/管理：深入回看、整理、管理和分析的界面。 | 后台、台后、admin（除非专指代码窗口 label）。 |

“前端 / 后端”仅在技术语境中使用：前端指 TypeScript/UI，后端指 Rust、Python 或外部服务；它们绝不等同于 Panel / Insight。

## 3. Insight 的领域区

Orbita Insight 当前和未来以领域区组织。用户界面可使用中文短名；正式文档使用完整名。

| 正式领域名 | UI 短名 | 角色 | 不要混称 |
| --- | --- | --- | --- |
| **Orbita Health** | 健康 | 健康、睡眠、活动、运动记录及相关回看。Garmin 是外部连接/来源。 | Garmin 页面、LifeData 健康程序。 |
| **Orbita Journal** | 随记 | 每日、作息、随记等个人记录。 | 仅指日记；Journal 数据文件时需明确。 |
| **Orbita Finance** | 财务 | 交易、账本、账户、分类、资产与负债等财务领域。 | 资产（总称）、记账（总称）、BKeasy。 |
| **Orbita Work** | 工作 | 工作相关的任务、工作区与外部工作连接。 | TickTick 本身。 |

“资产”是 Orbita Finance 内的视图、指标或子能力，例如资产总览、账户余额、净资产；它不是财务领域的总名称。

“记账”是用户动作，例如录入、编辑或确认一笔交易；它不是财务领域的总名称。

## 4. 数据层

| 名称 | 指代 | 当前关系 |
| --- | --- | --- |
| **Orbita Archive** | 用户长期个人档案的数据域：Journal、Finance、Health/Exercise、Knowledge、Media 等领域事实及未来跨域关联。 | 当前逻辑名称；物理上仍与 App State 共用 `dataDir`。 |
| **App State** | 应用如何运行的状态：设置、主题、窗口、启动器、缓存、凭据等。 | 当前与 Archive 物理共根；未来可与 `archiveRoot` 分离，但不是当前任务。 |
| **archiveRoot** | 未来可能承载 Orbita Archive 的物理共同根目录。 | 目标概念，尚未实现；不得假装为当前配置字段。 |
| **dataDir** | 当前应用实际使用的数据根目录。 | 现在同时含 App State 与 Archive 数据；不得擅自迁移或重命名。 |

Orbita Archive 不是一个 UI tab、不是第二个 exe、不是万能数据库。它保留领域独立性，并为未来跨领域上下文提供共同档案基础。

### 4.1 Archive Object 对象地图（Proposed）

本节是跨领域设计的总表，回答“什么是 Object、它有什么内部结构、什么只是子记录或数据”。它是 **Proposed** 模型：除特别标注为“现行”的存储外，不代表当前 SQLite、`.bean`、UI 或同步协议已经如此实现。

#### 层级与存储规则

```text
Domain（逻辑所有权）
└── Object type（可独立持久化、稳定引用的类型）
    └── Object instance（某一条实际对象）
        └── 内部子记录（随父对象存在，但不是 Object）
```

Object 是可被 `ArchiveRef = { domain, type, id }` 稳定引用的领域事实或稳定外部引用。它有自己的 `id` 与通用内部元数据（创建、更新、软删）；不同 Object type 不必共享一张表或一套业务字段。内部子记录可在 SQLite 中单独成表，以父 ID 关联，但不能独立进入 Connection、Timeline 或被别的 Object 作为档案对象引用。

| Domain | Object type | 该 Object 的核心结构与职责 | 内部子记录 / 专门关系 | 状态 |
| --- | --- | --- | --- | --- |
| Archive 公共层 | **Connection** | `0..N` 个成员引用组成的连接组；必填标题、可选短描述与对象专属 MD；可为空草稿、可嵌套但禁止自引用/间接环；不复制或接管成员 payload。成员软删后保留引用并显示“已删除”。关系 `kind` 保留为无行为的可选字段，证据、来源、状态等精确字段尚未定。 | `ConnectionMember`：概念上从属 Connection，保存一个 `ArchiveRef`；同一 Connection 内同一成员不得重复；反向关联由 Member 反查，不在成员 Object 写 `connectionIds`。 | Proposed |
| Journal | **Entry** | Journal 唯一目标 Object type；共同有 `kind`、必填 `startedAt`、可选 `endedAt`、可选 mood 与 Object 元数据。 | `kind = note`：少量文字、`hasDetail = 0`。`kind = document`：可选摘要、`hasDetail = 1` 与一份对象专属 MD 详细内容，也可有 mood。当前 `events`、`moods`、`notes` 是现行实现，尚未迁移。 | Proposed（现行存储另存） |
| Health | **Meal** | 一次可回看的进食事件。 | 可经 Connection 与交易、Entry 等形成上下文；营养、来源等仍由 Health 模型决定。 | Object 边界已定；现行模型另存 |
| Health | **Nap** | 一次可回看的午睡事件。 | Health 专有的时间/来源字段。 | Object 边界已定；现行模型另存 |
| Health | **Activity** | 一次可回看的活动/运动事件，可来自手工或 Garmin。 | 原始运动文件、指标等是其专业数据，不因此自动成为 Object。 | Object 边界已定；现行模型另存 |
| Health | **Sleep Night** | 一次可回看的夜间睡眠经历；有起止时间、可选睡眠摘要指标与来源；外部来源不改变其 Object 身份。 | `SleepStageSegment` 是以 `sleepNightId` 指向它的 SQLite 内部子记录；可用于 Timeline，但不是 Object 或 Connection 成员。 | Proposed；现行模型另存 |
| Finance | **Transaction** | 一笔账本交易；当前真源仍是 `.bean` / Beancount。Finance v2 的目标中，它是本地 SQLite 的 Archive Object。 | Posting 是 Transaction 的从属组件；账户、分类、余额等保留 Ledger 会计语义。 | 当前 `.bean` 真源；v2 Proposed / 未实现 |
| Work | **Project** | 工作边界与 Node Tree 容器；`title`、可选描述、`planning | active | archived`。它不冗余保存全部子 ID。 | Node 以 `projectId` 归属 Project；Project 归档/恢复遵守 Work 专门规则。 | Proposed |
| Work | **Node** | 工作树节点；共同字段为 `projectId`、可选 `parentNodeId`、`kind`、标题、排序。父节点同 Project 且无环。 | `kind = task`：`todo | active | done | parked | cancelled` 与 `planned | emergent | promoted` 来源。`kind = phase`：`planning | active | done | cancelled`、阶段/分组与计划范围；不使用 parked，完成只能手动触发并检查全部后代。一个父 Node 可同时有 task 与 phase 子 Node。 | Proposed |
| Work | **Session** | 一段真实工作的时间容器，可跨 Project；可先作为 draft/planned 工作计划存在，开始时至少含一个 Segment。 | Session 可有多个 Segment；计划时间可选，最终结束的 Session 必须有实际 `startedAt / endedAt`。结束时可收尾记录；active Segment 的收束有确认流程。 | Proposed |
| Work | **Segment** | Session 中一次具体推进；`sessionId`、必填 `projectId`、可选且至多一个 `nodeId`，可有计划时间、状态、摘要/结果。多个 Segment 可重叠。 | `Interval`：一个 Segment 内连续的开始至暂停/结束；可事后编辑。实际工作时长为 Session 内 Interval 的时间并集，重叠不重复计时。开始带 Node 的 Segment 可单向把 Node 从 todo 改为 active；暂停/结束不反向改 Node。 | Proposed；Interval 非 Object |
| Plan | **PlanItem** | 未来一项安排的唯一 Object type；共同有 `id`、标题、可选 `description: string`、`hasDetail: 0 | 1`、`todo | done | cancelled` 状态、自动 `completedAt?`、至多一个可选 `groupId` 与可选 `recurrenceId`。完成与取消必须手动；取消保留资料和历史。`kind` 可在显式操作中转换，保留同一 ID、Connection、详细内容与历史；有引用时只能取消，未被引用才可物理删除。 | `kind = todo`：`plannedTime: null | localDate | UTC datetime`，即无时间、某日或某时点的列表待办；不进 Timeline，时间是拟做/提醒点而非 deadline。`kind = schedule`：必填开始与结束、表示真实占用时间，进 Timeline；仅它可与 Segment 建立专门强关联。其它 Object 的上下文关联走 Connection。 | Proposed |
| Plan | **ScheduleBlock**（`PlanItem.kind = schedule` 的内部子记录） | 一条 Schedule 主时段前后真实会占用的准备、路途、缓冲时间；它不是任务拆分或子任务。 | 字段为内部 `id`、`scheduleId`、`side: before | after`、可拖动排序键、`durationMinutes`、`name`、`description: string`、`hasDetail: 0 | 1`。每侧最多 3 条；界面按排序动态显示“前置 1…3 / 后置 1…3”，删除会自动重排，不把 `-3..-1 / 1..3` 当固定身份。Block 与主时段/相邻 Block 严格首尾相接。`durationMinutes = 0` 仍保留为边界上的检查单/提示点。 | Proposed，非 Object |

#### 非 Object，但必须明确归属

| 项目 | 定位 | 为什么不是 Object |
| --- | --- | --- |
| `ConnectionMember` | Connection 的内部成员引用。 | 它只表达“父 Connection 包含哪个 ArchiveRef”，没有独立档案意义。 |
| `Interval` | Segment 的内部实际时间记录。 | 它只细化一次推进的连续工作段，不可独立连接或显示为人生资料。 |
| `PlanGroup` | Plan domain 的组织元数据；PlanItem 用可选 `groupId` 指向它，可用 `parentGroupId` 形成文件夹树。 | 它服务筛选、颜色、默认归类和同步，不进入 Timeline/Connection。原 `ScheduleGroup` 名称不再使用。 |
| `recurrenceId` | 一批由生成器一次创建的独立 PlanItem 的共同批次标识。 | recurrence 不是长期规则 Object；真源始终是每条可独立修改、完成、取消的 PlanItem。 |
| Health Day、Health Sample 与 SleepStageSegment | Health 的日汇总、时序采样与睡眠阶段数据。`Health Day` 一日一条，含体重/体成分、水分/喝水、日汇总指标；`Health Sample` 以父日记录、metric、series、UTC 时刻和值维护高频采样。 | 都不是可连接的个人经历；SleepStageSegment 从属 Sleep Night，Health Sample 从属 Health Day；每日快照可持久化，周期统计是可重建派生结果/缓存。 |
| Ledger 的 Account、Category、余额、分录 | Finance 的会计结构与查询结果。 | 它们仍有领域价值，但本轮未将其定为跨领域 Archive Object；不得为了连接而破坏 `.bean` 真源。 |
| Timeline 卡片、轨道、统计、Insight 结论、缓存、投影 | 查询/阅读或派生能力。 | 它们从领域事实读取，不创建万能事实表，也不反过来成为真源。 |
| Sync outbox、replica、remote shadow、pending command | 同步与外部副作用基础设施。 | 它们不是已经发生的人生事实；尤其 pending command 不得进入事实 Timeline。 |
| TickTick/Dida、Garmin、Beancount、Zotero、Obsidian | 外部系统、格式或适配器。 | 它们不是 Orbita domain。TickTick 在目标中是 Plan 的可选双向适配器；Garmin/Beancount 保留各自真源边界。 |
| App State、凭据、Panel 书签、窗口/主题配置 | 应用运行与界面状态。 | 它们不属于用户长期档案，也不应作为跨域关联成员。 |

#### 尚未建模的对象域

Travel（航班、火车、地点、轨迹）、Media 与 Knowledge 仍只有方向，没有已定 Object type 或 schema。它们将来可被 Connection 引用，但不得因为当前表格存在而被视作已经实现或已经决定。Course 也不是当前 Object：课表先由一批带 `recurrenceId` 的 Schedule 表达；只有需要教师、资料、作业、成绩等独立语义时才另立模型。

## 5. Finance 的分层名称

```text
Orbita Finance                 # 产品与领域总名
├── Finance UI                 # Orbita Insight · Finance
├── Finance Service            # 本地服务；当前以 Python sidecar 运行
├── Finance Domain
│   ├── Ledger                 # 账本模型：账户、分类、交易、余额
│   ├── Finance Parser         # 读取并解析当前账本存储
│   └── Finance Commit         # 校验后受控写入账本
└── Finance Storage            # 当前为 bean / Beancount 文件
```

| 名称 | 使用场景 | 说明 |
| --- | --- | --- |
| **Orbita Finance / Finance** | 产品、领域、UI 模块的默认名称。 | 覆盖交易、账户、分类、资产、负债与未来预算。 |
| **Finance Service** | 对外描述本地财务服务。 | 当前技术形态是 Python sidecar；技术排错时可说 Finance sidecar。 |
| **Ledger** | 财务领域内部的账本模型。 | 仅在账户、分类、交易、余额和账本语义中使用。 |
| **Finance Parser** | 财务数据读取/解析边界。 | 读取 bean/Beancount，不应偷偷写入。 |
| **Finance Commit** | 财务数据的受控写入边界。 | UI、AI、导入等写账都应经过相同的校验与提交语义。 |
| **bean / Beancount** | 当前底层存储格式。 | 不是产品名，也不是用户界面名称。 |

> **迁移状态必须区分：**上表描述的是当前实现，Finance `.bean` 仍是现行真源。目标 Sync Core 架构（ADR 0014 方向）中，Finance SQLite 将成为唯一可写、可同步的事实存储，PC 只从它受控、确定性地产生 `.bean` 以供 Beancount 校验和报告；不得形成 SQLite / `.bean` 双真源。该目标尚未迁移，不能据此改写当前 Finance 行为。

## 6. 历史名称：BKeasy

**BKeasy 是历史名称，不是 0.0.17 及以后现行产品名称。**

| 文档类型 | 使用规则 |
| --- | --- |
| `HISTORY.md`、`docs_legacy/`、旧版本 spec | 保留 BKeasy 原名与当时语境，不能改写历史。 |
| 当前状态、系统约定、开发说明、新 plan、新 spec | 统一使用 Orbita Finance / Finance。 |
| 迁移背景 | 首次可写“原 BKeasy，现 Orbita Finance”；后文使用 Finance。 |
| 现有代码 | `bkeasy`、`ledger` 等目录、command、字段名可能仍存在；它们是技术遗留，不能据此反推产品现名。 |

## 7. 技术名称与产品名称的映射

| 技术语境 | 产品/领域语境 |
| --- | --- |
| `main` 窗口 label | Orbita Panel |
| `admin` 窗口 label | Orbita Insight |
| `integrations/ledger/`、`ledger_sidecar` | Orbita Finance 的当前实现 |
| Python sidecar | Finance Service 的当前运行形态 |
| Garmin connector / sync | Orbita Health 的外部连接与数据来源 |
| TickTick connector | 当前实现中的 Orbita Work 外部连接与数据来源；Proposed 目标中它将是 Plan 的可选适配器。 |

代码内部名称不应被自动批量重命名。只有当重命名的兼容性、配置、数据迁移、构建和运行验证都写入计划并完成验收后，才能修改。

## 8. Proposed 数据架构术语（尚未实现）

本节为已收束的目标术语；它们是 Proposed 设计，不表示当前 SQLite、UI 或同步协议已经迁移。

### 8.1 Domain、Object 与引用

`Domain → Object type → Object instance` 是目标数据架构的三个层级。Domain 是逻辑所有权边界，决定真源、写入、删除、时间和同步规则，不由文件或表的位置决定。

**Archive Object（档案对象，简称 Object/对象）** 是可持久化领域事实或稳定外部引用；它不要求统一表结构。Health 中可作为 Object 的是用户可理解、可回看的事件/记录（已明确有餐食、午睡、活动、睡眠夜）；体重/体成分、水分/喝水、日汇总、高密度指标和其它派生数据仍是领域真源或投影，但不是可连接 Object。跨领域引用统一写作 `ArchiveRef = { domain, type, id }`；UUID 只负责唯一且不可变，不编码对象类型。

Timeline 卡片、趋势/统计、缓存、投影、outbox、pending command、Interval、Plan Group 与 App State 都不是 Object。

### 8.2 Connection

**Connection（连接）** 是 Archive 公共层的一种 Object：它囊括零个或多个 Object Member，表达成员之间或围绕该组形成的上下文关联。Connection 可以为空草稿，也可嵌套其他 Connection，但不得直接或间接形成环。

**Connection Member（连接成员）** 概念上从属 Connection，保存一个 ArchiveRef；Connection 不复制、不接管或改写成员 payload，成员本身也不保存 `connectionIds`，而由 Connection 层反查。

成员不必两两有明确关系；关系 `kind`、证据、来源和状态字段仍开放。会影响领域行为或统计的强关系不应走 Connection，例如 Work 树的父节点、Segment→Node、`PlanItem.kind = schedule`↔Segment。

### 8.3 Journal

目标 Journal 只有 `entry` 一种 Object type，内部 `kind = note | document`：

- **Note**：少量文字，可有 mood；`hasDetail = 0`。
- **Document**：可有 mood、摘要与一份对象专属 MD 详细内容；`hasDetail = 1`。

Entry 的 `startedAt` 必填、`endedAt` 可选；`createdAt / updatedAt / deletedAt` 是 Object 的内部元数据。当前 `events`、`moods`、`notes` 是现行实现，不能因本节自动迁移。

### 8.4 Work

```text
work
├── Project
├── Node (kind: task | phase)
├── Session
└── Segment
    └── Interval（子时间记录，不是 Object）
```

Project 是工作边界与 Node Tree 容器；Node 用 `projectId + parentNodeId` 构成树。Phase 的状态为 `planning | active | done | cancelled`，不使用 parked；完成必须由用户手动触发，并递归检查后代。Session 是可跨 Project 的实际工作时间容器；实际开始/结束时间在最终结束的 Session 中必填。Segment 属于 Session，`projectId` 必填、`nodeId` 可为空且至多一个，多个 Segment/Interval 可以重叠。Segment 可在用户明确操作时创建或更新关联的 Schedule；Schedule 不据此反向推导或自动创建 Segment。Branch 是 `origin = emergent` 的 Task Node，不是独立 Object，只有显式 Promote 才能改变其 Main/计划地位。

### 8.5 Plan

**Plan** 是独立领域，承载未来意图；它不是 Work Task、TickTick Task 或 Session。其唯一 Object type 是 **PlanItem**，由 `kind` 决定两种形式：

- **Todo**：`plannedTime = null | localDate | UTC datetime` 的列表待办；不进入 Timeline。时间是拟做/提醒点而非 deadline。
- **Schedule**：有必填开始与结束的真实时间占用安排；进入 Timeline，并可拥有前后各最多 3 个严格连续的 ScheduleBlock。

Todo 补齐起止时间后可经显式操作升格为 Schedule：若 Todo 有时点，`plannedTime` 预填 Schedule 的 `startAt`，用户补齐 `endAt`。Schedule 去除具体时段后可降为 Todo，并把原 `startAt` 保留为 `plannedTime`。转换只改变同一 PlanItem 的 `kind` 与对应字段，不更换 ID 或丢失 Connection、详细内容、分组、完成历史。完成/取消均手动；取消保留 Block、详细内容与历史。只有 Schedule 可与 Segment 建立专门强关联；其它 Object 的普通上下文关联统一使用 Connection。

支持详细内容的对象使用 `hasDetail: 0 | 1`，默认 `0`。详细内容路径由该对象自己的 id 确定：`{archiveRoot}/details/{id}.md`；创建时写入 MD 并置为 `1`，明确删除时删除 MD 并置回 `0`。`hasDetail = 1` 时，点击详情图标直接读取固定路径；文件缺失则显示“详细内容缺失”，并允许用户明确新建空白 MD。无需存储通用 `ref`/`refs[]` 字段；它们不得与跨对象的 `ArchiveRef` 混淆。

`PlanGroup` 是随 PlanItem 同步的组织元数据，不是 Object；每条 PlanItem 至多一个可选 `groupId`，未来可由 `parentGroupId` 组成文件夹树。重复安排由生成器创建多条同 kind 的独立 PlanItem，并以共同 `recurrenceId` 标识，不建立长期规则 Object；单条升格/降级不影响同批其他项。

目标中 TickTick/Dida 是 Plan 的可选外部适配器和未来双向同步出口；当前 TickTick 任务真源与桌面直连行为并未因此改变，仍以当前实现文档为准。

### 8.6 时间、兼容性与开放项

精确时刻底层存 UTC。**Business Time Zone（业务时区）** 是目标中的全局设置，当前默认 `Asia/Shanghai`，未来逐步替代硬编码上海逻辑；历史业务日期不能被任意当前时区重新解释。

未知 Object type 必须保留且不可编辑；已知类型的未知字段应警示潜在丢失风险，并阻止会重写 payload 的编辑，除非用户明确接受风险。

所有**可同步**的 Object，以及需要随其同步的 Data / Component，都以各端本地 SQLite 为事实存储，并走同一个通用 Sync Core：Object 或独立 data-root 是 aggregate 根，Component 与严格子 Data 随父 aggregate 原子传输。Sync Core 传递规范化 aggregate，不传 SQLite 文件；本机 MD 路径不是同步身份。某个支持详细内容的 Object 进入同步后，detail 内容及其 manifest 随该 Object 的 aggregate 原子传输。Garmin 的特殊性只在于授权 connector 产生事实；不另有一套同步 Core。Observation、缓存、投影、outbox、凭据和本地 materialization 不因此进入同步。

仍开放：Connection 关系/证据 schema、MD 的备份、编辑冲突与恢复体验、Plan Group 完整规则、priority、TickTick 映射与冲突，以及 Travel、Media、Knowledge 的对象树。

## 9. 同步与外部适配模块（Proposed）

以下三个名称是目标架构的正式模块名。它们仍是 Proposed，未表示现有桌面、服务器或外部连接已经迁移；但后续同步设计、计划和实现不得再为各领域另造平行同步系统。

| 正式名称 | 职责 | 不是 |
| --- | --- | --- |
| **Sync Core** | 以 SQLite 中的版本化 Archive aggregate 为单位，协调 PC、手机与服务器副本的本地 outbox/inbox、版本、冲突、历史、投递、ACK、恢复和诊断。Finance v2 Transaction / Posting 与其它 Object/Data/Component 复用同一个 Core。 | 万能领域表、SQLite/目录文件复制、Garmin 或 TickTick 的 API client、`.bean` materializer。 |
| **Garmin Ingest** | 服务器唯一 Garmin credential holder、API caller、normalizer 与 Garmin-authority writer；把规范化 Health aggregate 交给 Sync Core 分发。 | 第二套跨端同步、客户端可伪造的 `source` 字段、Archive domain/Object、PC/手机 Garmin collector。 |
| **Schedule Adapter** | 服务器对 `plan/plan-item(kind = schedule)` 与 TickTick 的可选双向外部映射；外部动作以 adapter command 执行，结果只能经 Sync Core 的受控 adapter commit 写入同一 Schedule aggregate。 | Work/Plan 的真源、独立任务对象、第二个 Sync Core、TickTick 驱动的本地事实模型或直接 Archive SQLite 写入者。 |

`.bean` 是 PC 上 Finance SQLite 的受控、确定性单向 materialization，用于 Beancount 校验和报告；它不是第四个同步模块、跨端真源或同步 payload。身份、加密、备份、operation timeline、Sync Doctor 与恢复是 Sync Core 的横切能力，不单列成第四套系统。

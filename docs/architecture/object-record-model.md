# Orbita 记录分类与 Health / Connection 结构

> **状态：Proposed。** 本文记录已收束的目标数据语义，不代表当前 SQLite 已迁移到这些表或字段。当前实现事实见 [CURRENT.md](../CURRENT.md)；机器形草案见 [object-schema-registry.proposed.json](object-schema-registry.proposed.json)。

## 1. 先区分记录身份与物理表

SQLite 的一张表只是同种记录的长期容器，类似 Excel 的一个 sheet；一行才是一条记录。表存在、记录有 UUID、或记录有父 ID，都不会自动使它成为 Archive Object。

目标 registry 的所有记录类型平铺在同一个 `records` 目录中。每种记录用 `classification` 指明身份：

| classification | 含义 | 能否成为 `ArchiveRef` / Connection 成员 | 例子 |
| --- | --- | --- | --- |
| `object` | 用户可独立理解、回看和连接的档案事实。 | 可以。 | Meal、Activity、Sleep Night、Connection。 |
| `data` | 测量、采样、日汇总或派生数据。可以独立存表，也可以拥有父记录。 | 不可以。 | Health Day、Health Sample、Sleep Stage Segment。 |
| `component` | 只表达父记录内部结构的组成件。 | 不可以。 | Work Interval、Schedule Block、Connection Member。 |

父子归属是另一条独立信息：`parent = { record, foreignKey }`。因此 `SleepStageSegment` 是 **Data 且是 Sleep Night 的子表**；`HealthSample` 是 **Data 且是 Health Day 的子表**。这与 `ConnectionMember` 是 Component 且从属于 Connection 并不冲突。

### 同步边界（Proposed）

所有可同步的 `object` 与独立 `data` 根都在各端本地 SQLite 保存，并通过同一个通用 Sync Core 传输完整、版本化的 aggregate；`component` 与严格子 `data` 永远随父 aggregate 原子同步。它不复制 SQLite 文件，也不按领域另建同步机制。Garmin 仅是受授权的 connector 事实入口；Finance Transaction / Posting 未来也复用该 Core。缓存、投影、outbox、凭据、Observation 和本机 materialization 不属于同步 aggregate。对象 detail 的本机 MD 路径不是身份；启用同步时，内容与 manifest 随所属 aggregate 提交。

## 2. Health 的总体形状

```text
Health
├── Object
│   ├── Meal
│   ├── Nap
│   ├── Activity
│   └── Sleep Night
│       └── Sleep Stage Segment（Data 子表）
└── Data
    └── Health Day（一日一条）
        └── Health Sample（高频时序采样子表）
```

Meal、Nap、Activity 与 Sleep Night 是用户可说“发生过的一件事”的独立事实，因此可被 Connection 引用。体重、体脂、喝水、步数、消耗、日健康摘要及各种采样并不是独立档案对象；它们服务于当天回看、时间轨道和趋势。

### 2.1 Health Object

| Object | 已定业务字段 | 说明 |
| --- | --- | --- |
| **Meal** | `startedAt`、`endedAt?`、`slot?`、`text?`、`kcal?`、`carbsGrams?`、`proteinGrams?`、`fatGrams?`、`source` | 所有时间存 UTC；餐别为 `breakfast | lunch | dinner | other`。 |
| **Nap** | `startedAt`、`endedAt`、`text?`、`source` | 时长由起止时间计算，不另存。 |
| **Activity** | `startedAt`、`endedAt`、`type`、`title?`、`text?`、距离/爬升/HR/速度/配速/功率摘要、`source` | `type` 直接保存 Garmin `activityType.typeKey`；它只控制字段的读写/显示 profile，不改变可存字段。路线、逐采样指标、分段、训练组与原始文件属于 Garmin adapter detail。 |
| **Sleep Night** | `startedAt`、`endedAt`、`text?`、`source`、`sleepScore?`、平均 HR/HRV/SpO₂/呼吸率 | 睡眠时长由起止时间计算；“醒来日”由 `endedAt + Business Time Zone` 推导，不另存。 |

Object 都有公共内部元数据 `id`、`createdAt`、`updatedAt`、`deletedAt?`。精确时刻统一为 UTC；日期显示与输入按全局 Business Time Zone 解释。

### 2.2 Sleep Stage Segment

`health/sleep-stage-segment` 是 Data，物理上单独成表，通过 `sleepNightId` 归属一条 Sleep Night：

| 字段 | 含义 |
| --- | --- |
| `sleepNightId` | 父 Sleep Night。 |
| `startedAt` / `endedAt` | UTC 阶段区间。 |
| `stage` | `awake | light | deep | rem`。 |

阶段可以直接供 Timeline 绘制。所有阶段必须落在父睡眠起止范围内，彼此不能重叠；设备未采到的数据允许留下空洞。深睡、浅睡、REM、清醒总时长从分段计算，不另立重复真源字段。

### 2.3 Health Day 与 Health Sample

Health Data 暂定只使用两张长期业务表；日期增加只会增加行，不会创建新表。

```text
health_days       # 一行 = 一个 localDate 的日汇总
health_samples    # 一行 = 某日某时刻的一条指标值
```

**Health Day** 的业务主键是 `localDate`。已定的可选日字段包括：

- 心率：静息、最低、最高、平均 bpm；
- 血氧：平均、最低百分比；
- Stress：平均、最高；
- Body Battery：最高、最低、充入、消耗；
- 呼吸率：平均、最低、最高；
- 行为与能量：总步数、总距离、总/活动/基础消耗 kcal、总饮水 ml；
- 身体：`weightKg`、`bodyFatPercent`。

**Health Sample** 用 `healthDayId` 指向其 Health Day，并保存：

| 字段 | 含义 |
| --- | --- |
| `metric` | `heartRate | spo2 | stress | bodyBattery | respiration | steps`。 |
| `series` | `default | daytime | sleep`；尤其用于区分白天与睡眠期的 SpO₂。 |
| `at` | UTC 采样时刻。 |
| `value` | 数值；单位由 `metric` 决定。步数是累计值。 |

HR、SpO₂、Stress、Body Battery、呼吸和步数都共用这张长表；查询层按 `metric`、`series` 和时间范围筛选，再组织成时间线曲线、柱或 tick。Sleep Stage 不进入 Health Sample，因为它属于某个 Sleep Night 的阶段划分，而不是某个自然日的单值采样。

### 2.4 Garmin 重拉

第一版把 Garmin 的某个 `localDate` 看作一份完整快照：

1. 对规范化后的日字段与采样集计算内容 hash；相同则不写入。
2. 不同则在**同一 SQLite transaction**内更新该日 Garmin 字段、删除该日旧 Garmin Health Sample、写入完整的新采样集。
3. 不做逐点 merge，以免旧采样残留或产生难以解释的混合曲线。

手填日指标尚未进入首版。将来若加入，必须另定显式的 override、来源与优先级规则；不得静默把手填与 Garmin 日字段混合。

## 3. Connection

Connection 是 `archive/connection` Object。它不复制任何成员的业务内容，只保存“这些 Object 处于同一上下文”的可追溯成员引用。

### 3.1 Connection 本体

除 Object 公共元数据外，Connection 有：

| 字段 | 规则 |
| --- | --- |
| `title` | 必填。空 Connection 也需由它识别。 |
| `description?` | 可选短说明。 |
| `hasDetail` | `0 | 1`；详细内容固定为 `{archiveRoot}/details/{id}.md`。 |

Connection 允许 `0..N` 个成员。因此它可先作为手动建立的空连接组，后续再逐步加入对象。

### 3.2 Connection Member

`archive/connection-member` 是 Component，物理上独立存储，但不是 Object。其业务字段为：

| 字段 | 含义 |
| --- | --- |
| `connectionId` | 父 Connection。 |
| `memberDomain` / `memberType` / `memberId` | 逻辑上的 `ArchiveRef = { domain, type, id }`。 |
| `kind?` | 暂时为无行为的可选字符串；不做枚举、不改变成员事实。 |

同一 Connection 内同一成员只能出现一次，唯一键为 `(connectionId, memberDomain, memberType, memberId)`。成员 Object 被软删后，Member 不自动删除；读取时显示“已删除”，以保留历史上下文。

Connection 本身可以作为另一 Connection 的成员。只禁止自引用与任意间接环；不额外限制其它嵌套形式。专门领域关系（Work 树、Segment → Node、Schedule ↔ Segment 等）仍使用领域字段，不能伪装成 Connection。

## 4. 尚未进入本模型的事项

- Health Day 的更多体成分字段，以及采样 coverage/质量元数据；
- Connection 的证据、来源、状态与 `kind` 的具体语义；
- Garmin adapter detail 的原始 payload、文件保存与刷新策略；
- Work、Plan、Finance、Travel、Location、Knowledge、Media 的后续字段收束与迁移。

这些进入实现前仍须单开计划，定义 SQLite DDL、索引、迁移、事务 outbox、同步与用户验收；本文不授权修改现有用户数据。

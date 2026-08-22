# Orbita Journal 与 Orbita Health：当前数据与同步契约

> **性质**：现行、可执行的领域规格；适用于修改 Journal 数据、Orbita Health（Garmin）同步、今日区记录或相关 AI 工具前。  
> **当前代码基线**：见 `../CURRENT.md`；长期数据方向见 `../architecture/data-layer-vision.md`。  
> **术语**：产品与领域名称采用 `Orbita Journal`、`Orbita Health`。`journal`、`garmin`、`daily`、`routine`、`exercise` 是现有代码、文件字段或记录 kind，保留为技术名称。  
> **历史来源**：v0.0.14 §8–10、§19–20 以及 legacy HANDOFF §25.0.0–25.0.15。历史原文不改写；本文件只沉淀仍约束当前实现的结论。

## 1. 边界与真源

Orbita Journal 是 Orbita Archive 中的结构化个人记录领域；Orbita Health 是健康、睡眠、活动和运动记录领域。二者可以共享当前的 Journal 年文件，但不能因此被当作同一产品模块或万能事件模型。

- **Journal**：每日、作息、餐食、事件、心情与运动条目的当前结构化存储。
- **Health**：以 Garmin 为外部数据来源；同步将允许的健康事实写入 Journal 结构。Garmin 不是产品页面或独立应用。
- **事实优先**：原始运动文件、导入事实与人工记录优先于统计、缓存、AI 摘要和推断；后四者不得覆盖或伪装成真源。
- **当前物理根**：`dataDir` 仍同时承载 App State 与 Orbita Archive。Journal 根由 `integrations.journal.dataRoot` 决定；为空时回退到当前 `dataDir`。不得为未来 `archiveRoot` 擅自搬运、复制或重命名用户数据。

当前文件布局：

```text
{journalRoot}/
└── journal/
    ├── 2025.json
    └── 2026.json
```

每个年文件为：

```json
{ "entries": [ /* JournalEntry[] */ ] }
```

文件不存在时读取为空；首次写入才创建年文件与 `journal/` 目录。不要将个人数据写回仓库、安装目录、未分桶的浏览器全局 `localStorage` 或其他绕开 `dataDir` 的位置。

## 2. 共同字段、日期与稳定 ID

所有条目至少具有：

```ts
type JournalEntryBase = {
  id: string;      // journal/YYYY.json:{uuid}
  kind: string;
  date: string;    // YYYY-MM-DD，Asia/Shanghai 日历日
  data?: object;
};
```

`date` 是业务归属日，不是展示时由本机时区重新推算的时间戳。日历、默认日期、范围查询与时间录入统一使用 `Asia/Shanghai`；手填日期+时分必须先按北京时区转换为 Unix 秒，不能交给浏览器本地时区猜测。

ID 与 upsert 规则：

| kind | 唯一性与写入规则 |
| --- | --- |
| `daily` | 每个 `date` 一条；按 `date + kind` 覆盖，必须保留原 `id`。 |
| `routine` | 每个醒来日一条；按 `date + kind` 覆盖，必须保留原 `id`。 |
| `exercise` | Garmin 导入时按 `externalId` 去重并覆盖，保留原 `id`；手工条目按 `id`。 |
| `event`、`mood` 与其他多条 kind | 新建生成 UUID；编辑/删除按 `id`。 |

删除通过 `id` 反推出年文件；无效或不存在的 ID 必须报错，不能静默成功。新建 ID 形如 `journal/2026.json:<uuid>`，不得用数组索引或日期充当可长期引用的 ID。

## 3. 关键记录语义

### 3.1 `daily`：Health 汇总与餐食容器

`daily` 是“当天汇总”而不是普通可任意替换的事件。Orbita Health 的 Garmin 同步会更新其健康字段；Orbita Journal 的餐食和喝水也存入同一条目的 `data`，所以任何写入都必须**合并既有 `data`**，不能整对象覆盖。

- `daily.meals`：一日的餐食列表；每一餐有自己的稳定 `id`，修改或删除按 meal id，不新增独立 `meal` kind。
- `daily.hydrationMl`：当天饮水量；手动修改同样须保留其余 daily 数据。
- Garmin 日汇总写入必须保留 `daily.meals`，不得因同步清空用户录入的餐食。
- 今日三环的固定含义为：睡眠 / 摄入-消耗 / 喝水。餐食贡献摄入；睡眠取 `routine`；健康导入可提供消耗和喝水等 daily 字段。

### 3.2 `routine`：睡眠与午睡

`routine.date` 是**醒来日**，不是入睡日；跨午夜睡眠归醒来所在的北京日历日。`data.night` 存入睡、醒来 Unix 秒及可选 Garmin 分期/评分；`data.naps` 是午睡列表。

- Garmin 同步只可覆盖 `data.night`；必须保留既有 `data.naps`。
- 人工调整夜睡只更新人工提供的字段；没有 Garmin 分期或评分时，不得伪造 `stages`、`score`。
- 睡眠阶段环只以 `deep + light + rem` 计算睡眠时长；`awake` 可保存，但不计入睡眠时长。
- UI 可输入日期和时分，不应强迫用户处理 Unix 时间戳；持久化前使用统一的北京时区转换。

### 3.3 `mood`、`event` 与 `exercise`

- `event` 与普通 `mood` 可同日多条，以 `id` 编辑和删除。
- `mood.primary: true` 每日至多一条；写入新的主心情前，必须把同日既有主心情降为 `false`。非主心情要显式规范化为 `primary: false`，不要让未定义状态变成第二个主心情。
- `exercise` 保留运动领域字段；Garmin 导入的骑行以 Garmin `activityId` 作为 `externalId` 去重。不要把不同运动类型强塞进不兼容的 Journal 结构。

## 4. Orbita Health / Garmin 同步

### 4.1 生命周期与凭据安全

Garmin token 是用户可恢复的会话资产；SSO 是稀缺且会触发账号级限流的显式操作。**任何同步路径必须零 SSO**：设置同步、今日区同步、Agent 同步和自动同步只能使用已有 token 刷新并拉取数据。

| 情况 | 必须行为 |
| --- | --- |
| token 缺失 | 返回 `no_token`，提示用户走显式“重新登录 Garmin”；不得同步中登录。 |
| token 无效 | 返回 `token_invalid`；不得删除 token 或自动尝试多条登录路径。 |
| 429 / 限流 | 写入本地 `garmin_rate_limit.json` 并停止；删除该文件只能解除本地冷却，不能解除服务器封禁。 |
| 显式登录 | 单路由、单次尝试；不得多端口、多代理、多策略组合重试。 |

默认 token 目录为 `{dataDir}/garmin`，token 文件为 `garmin_tokens.json`；自定义 token 目录仍是现有配置兼容能力。旧的 `~/.garminconnect` token 仅在必要时迁入目标目录；不得把 token、账号、密码、日志或真实健康数据提交到公开 Git。

### 4.2 同步输入与输出

Rust `garmin_sync` 运行项目 Python 环境中的 `scripts/garmin_sync.py`；同步前须确认 Journal 根可用。默认范围为截至今天的最近 7 个北京日历日（调用者可明确提供 `from` / `to`）。同步结果返回 `dailyCount`、`routineCount`、`exerciseCount`，失败返回可行动的 `reason`。

成功结果按以下顺序写入：

1. 日汇总 → `daily`；合并旧 `data`，保留 `meals`。
2. 睡眠 → `routine.data.night`；保留既有 `naps`。
3. 运动 → 目前仅写入 `sport === "cycling"` 的 `exercise`；按 `externalId` 去重。

“同步成功”只表示脚本和写入流程成功，不表示 Garmin 有所有类型的数据。非骑行 `exercise` 写入、完整 Media/Trail 归档及其他外部健康来源均未在当前契约中实现。

### 4.3 原始运动文件

`.fit` 是 Orbita Archive 中有长期价值的原始健康事实；未来索引或洞察可基于它，但不能以派生统计替代或销毁它。当前同步/存放实现的具体覆盖范围必须以代码与验收为准；不要在没有独立计划时声称所有活动的 `.fit` 已完整归档，也不要为“统一数据模型”重写 Garmin 语义。

## 5. AI 与写入边界

Journal 写、删和 Garmin 同步都是用户数据写入：必须走现有确认交互。查询、摘要与显示可直接读取，但 AI 不能把推断写成事实，也不能声称尚未实现的财务或健康写入已经完成。

- 吃饭相关请求可通过既有 Journal 工具提出记录与确认；热量若为估计，应明确其不确定性。
- Agent 读取 Journal 时应尊重醒来日、`daily.meals` 和已有数据合并规则。
- 不得通过“修复”静默重建、清空、替换 Journal 年文件、token 或 Garmin 数据。

## 6. 修改与验收清单

涉及 Journal / Health 的改动，至少按实际影响完成相应验收；未实测不得标为完成。

| 改动 | 最低验收 |
| --- | --- |
| Journal CRUD / kind / ID | 新建、更新、删除；跨年读取；`daily` / `routine` 保留原 ID；多条 kind 不互相覆盖。 |
| 餐食或喝水 | 写入后保留 Garmin daily 字段；Garmin 同步后 `meals` 仍存在；修改/删除只影响目标餐食。 |
| 睡眠 | 跨午夜归醒来日；手填时间按 `Asia/Shanghai` 正确持久化；同步更新 night 后 naps 仍存在。 |
| Garmin 同步 | 有 token 时能完成指定范围同步；缺 token 返回 `no_token` 且不触发登录；失败不删除 token；429 不循环重试。 |
| Garmin 活动 | 重复同步同一 `externalId` 不产生重复骑行；非骑行不会被当前代码写入 exercise。 |
| 数据目录切换 | 切换后读取新根数据；不复制旧 Journal/Health 数据；跨窗口刷新而非仅本窗口 `CustomEvent`。 |

完成代码修改后，必须按仓库规则运行 `orbita/dev.bat`，等待启动完成且确认无报错；未经用户明确要求，不运行 `cargo check` 或 build。

## 7. 当前明确未实现或待另立计划的内容

- 将 `dataDir` 物理拆分为 App State 与 `archiveRoot`，以及任何自动迁移/备份策略。
- 统一所有领域为万能 `Event`、图数据库或自动跨域归因。
- Connection / Semantic 的正式产品形态与数据模型。
- 非骑行 Garmin 活动写入 Journal、完整 Trail/Media 管理、所有 `.fit` 的索引与浏览体验。
- 在 Orbita Insight 内完成 Health / Journal 领域业务页面；当前 Insight 的这两个领域区仍以壳和后续工作为主。
- Garmin MFA 的应用内自动化、同步时自动 SSO、删除 token 作为常规排错。

这些边界若要改变，必须先建立新 plan，并更新相关 `DECISIONS` 与本规格；不得仅凭代码审查建议回退已有安全或数据语义。

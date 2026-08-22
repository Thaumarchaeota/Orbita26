# Orbita Finance 规格

> **状态**：`0.0.17-snapshot` 的现行可执行规格。  
> **范围**：产品边界、Insight UI、Finance Service、Parser / Commit、bean 存储、阶段与验收。  
> **术语**：遵循 [GLOSSARY.md](../GLOSSARY.md)。BKeasy 只在迁移历史中出现，不是现行产品名。  
> **优先级**：本文件的“当前实现 / 最新结论”优先于旧规格；旧资料只作历史证据，不能是实施前提。

## 1. 边界与命名

**Orbita Finance** 是 Orbita 的财务领域，在 **Orbita Insight · 财务** 中提供交易、账本、账户、分类、资产和负债的回看、整理及受控写入。

| 名称 | 正确含义 | 不要混称为 |
| --- | --- | --- |
| Finance | 产品与领域总名 | 单一“资产”页面或记账动作 |
| 资产 | Finance 的视图 / 指标 / 账户集合 | 财务领域总名 |
| 记账 | 新建、编辑、确认交易的动作 | 服务或数据模型 |
| Ledger | 内部账本模型 | 用户可见产品名 |
| Finance Service | 本地财务服务，当前为 Python sidecar | 账本数据本身 |
| Finance Parser | 读取、解析 bean 的边界 | 写入流程 |
| Finance Commit | 校验后受控写入账本的边界 | 任意保存按钮 |

现行承诺：Finance 是单一 Orbita 应用的领域；完整 UI 只在 Insight；用户的 bean/Beancount 文件是唯一真源；Python 保持 Parser / Commit 职责；现有技术目录、command、字段中可仍有 `ledger`、`bkeasy`，未经单独兼容计划不批量改名。

不做：手机端、NAS / 公共 Web API、Rust 重写 parser / commit、beancount 库或 BQL、账户 CRUD、跨日拖拽、`seq` 落盘、`*_inv.bean` 读写、自动数据迁移、未经确认的 AI 写账。

## 2. 当前运行时与数据根

```text
Orbita（一个 Tauri 进程）
├─ Orbita Panel（main）     → 不启动 Finance Service
└─ Orbita Insight（admin）
   └─ Finance UI → Finance Service（Python / FastAPI / loopback）
                    ├─ Finance Parser → bean/Beancount
                    └─ Finance Commit → bean/Beancount
```

当前没有已实现的 `archiveRoot`。`dataDir` 同时含 App State 与 Orbita Archive 的早期数据，Finance 唯一数据根固定为：

```text
{dataDir}/bill/
├─ account.bean                 # Assets / Liabilities open 行
├─ category.bean                # Expenses / Income open 行
├─ ledger/{year}.bean           # 按年交易；默认 write target
└─ .bkeasy/settings.json        # 历史兼容目录名；保存 write_target
```

只支持该扁平布局。`account/` 目录、`ledger.md`、旧多目录布局均不支持。`dataDir` 必须是包含 `bill/` 的根；把 `bill/` 本身选成 `dataDir` 会解析为 `bill/bill/`。历史 `integrations.bkeasy.dataRoot` 不参与现行根解析，也没有可编辑 UI。

### Service 生命周期

| 场景 | 必须行为 |
| --- | --- |
| Panel / Agent 启动 | 不启动 Python。 |
| Insight 打开 | 异步 ensure Service；窗口显示不能同步等待服务。 |
| Finance 连接 | 调 `ledger_api_base`，仅使用 Rust 返回的实际 base；不得 fallback `:8000`。 |
| 同进程 child、根一致、health OK | 才可复用。 |
| dataDir 已变、child 丢失、仅有 port | stale：不认领旧进程，重新启动。 |
| 默认端口被历史服务占用 | 8000–8010 选择可绑定端口，新服务读正确根。 |
| 用户“重试” | reset base → `restart_ledger_sidecar` → reconnect；不是单纯重试 fetch。 |
| Orbita 退出 | 结束本进程启动的 Python child。 |

Service 仅绑定 `127.0.0.1`。Rust 注入 `ORBITA_LEDGER_DATA_ROOT`、`ORBITA_LEDGER_HOST`、`ORBITA_LEDGER_PORT`；解释器为 `orbita/python/.venv/Scripts/python.exe`（允许 `ORBITA_PYTHON` 显式覆盖）。启动失败必须返回可行动信息；stderr 写临时日志，不得吞错。

### dataDir 切换

dataDir 切换是换用一套用户数据，不是迁移：保存新 bootstrap/settings，不复制旧目录；两个 webview 重载其数据；将仍指向旧根的可 rebase 路径清空或重置；重启 Finance Service 以读新 `{dataDir}/bill`。新空目录须显示“未就绪”，不能泄漏旧账本。不得自动生成或覆盖账本；只有用户明确点“新建”或“新建（覆写）”时允许初始化。

## 3. Finance UI（当前实现优先）

当前 IA 是 **Dashboard Hub + 钻取**，已取代历史规格的六个平铺子导航。

```text
Insight · 财务
└─ Dashboard（默认）
   ├─ 指标卡片 → 统计
   ├─ 最近交易 / 全部 → 整理
   └─ 导入 → 导入页

保留但未挂正式入口：分类管理、账户管理
```

| 页面 | 现行职责 | 状态 |
| --- | --- | --- |
| Dashboard | 指标、最近交易、统计 / 整理 / 导入入口 | UI 结构已落；指标和最近交易仍占位。 |
| 统计 | 本月支出、分类 Top 10 的客户端聚合 | 代码已落，待真实账本对账。 |
| 整理 | 筛选、阈值化渲染、inline 编辑、同日排序、右栏记一笔、Commit | 代码已落；真实 Tauri 交互待验收。 |
| 导入 | CSV 模板、解析校验、内存 staging 后交给同一 Commit | 代码及自动化回归已落；真实 Tauri 导入→保存→重开待验收。 |
| 分类 | Expenses / Income 标签编辑 | 代码保留，未挂入口。 |
| 账户 | Assets / Liabilities 只读 | 代码保留，未挂入口。 |

页面切换 keep-alive，保留 DOM 和滚动位置。Dashboard / 统计各自内容区滚动；整理仅列表和右栏滚动，工具栏固定。

### 连接、未就绪与初始化

```text
ledger_api_base → GET /health → GET /api/settings → GET /api/accounts
→ 四组账户总数 > 0 → Dashboard；异步 load entries
```

服务健康不代表账本可用。账户总数为 0 时显示“资产管理服务未就绪”，说明需要 `account.bean`、`category.bean`、`ledger/*.bean`。

| 操作 | 条件与行为 |
| --- | --- |
| 新建 | `bill/` 不存在或为空时创建最小骨架，重启服务并重连。 |
| 新建（覆写） | `bill/` 非空时必须明确确认，才覆写骨架文件。 |
| 重试 | 连接失败或未就绪时，重启 Service 后重新连接。 |

骨架为 `account.bean`、`category.bean`、当年 `ledger/{year}.bean`、`.bkeasy/settings.json`；历史目录名不得显示为产品名。

### 整理：筛选、编辑与排序

| 规则 | 语义 |
| --- | --- |
| 日期 | `YYYY-MM-DD` 含端点过滤；空为不限。 |
| 类型 chip | 支出 / 收入 / 转账 / 投资多选；不选等于不过滤。 |
| 软删 | `_deleted` 仍显示（淡红），直到 Commit 成功。 |
| 展示排序 | 日期降序；同日有效 `time` 升序（早→晚）；无有效时间记录在后，按数值 `seq` 升序稳定兜底。见 [`ADR 0002`](../adr/0002-finance-chronological-order-without-drag.md)。 |
| 落盘排序 | 日期升序；同日有效 `time` 升序；无有效时间记录在后，按数值 `seq` 升序。 |
| 拖拽 | **不提供**。同日顺序由 `time` metadata 与 `seq` 稳定兜底决定，不由用户拖拽改写。 |

首屏加载近 90 日，异步再补全全量。部分加载时保存禁用，避免局部列表覆盖整文件。列表在 10,000 条以内连续渲染，超过该阈值才使用虚拟渲染；保留日期分隔和 sticky date pin。阈值依据见 [`ADR 0001`](../adr/0001-finance-detail-render-threshold.md)。

可编辑：日期、时间（`HH:mm`）、payee、remark、type、flag、tags、posting 的 account / amount / currency / cost。**展示**：列表按日期分组，sticky date pin 显示 `YYYY-MM-DD`；交易卡片 identity 行**仅显示时间**（无日期列），无有效时间时 ghost「时间」。**编辑**：点击时间字段打开 portal popover，同屏编辑日期与时间；日期变更时，仅将严格有效且原日期匹配的 `time` 前缀同步到新日期；清空时间移除 `time` metadata。remark 上限 50。Enter 提交、Escape 取消、点击外部提交（校验失败时 popover 保持打开并显示错误）；点保存前也提交当前编辑。金额改变实时预览配平。

### 右栏“记一笔”

| 模式 | 内容 |
| --- | --- |
| 支出 | Expenses 分类 + Assets/Liabilities 支出账户。 |
| 收入 | Income 分类 + Assets 收入账户。 |
| 转账 | Assets/Liabilities 发起与接收账户。 |
| 高级 | 2–10 条 posting，可有成本；实时配平。 |

字段：金额、币种（默认 CNY）、日期、remark、flag、payee、tags。点击“记录”只创建内存 Entry 并刷新整理页，**不写盘**；必须与编辑、删除共用下列 Finance Commit。

### Finance Commit 保存状态机

```text
edited → checking (POST /api/validate) → confirming
→ submitting (POST /api/commit) → reload authoritative files → unedited
```

| 状态 | 规则 |
| --- | --- |
| `unedited` | 与 baseline 和 commit order 一致；保存禁用。 |
| `edited` | 有语义变更且非已校验快照；可保存。 |
| `checking` | validate 中，禁止重复操作。 |
| `confirming` | 校验通过且状态未变；用户需再点“确认保存”。 |
| `submitting` | commit 中，禁止重复操作。 |
| `partial` | 全量加载未结束；不可保存。 |

校验失败回 `edited` 并定位首个字段错误；提交失败回 `confirming` 并保留状态；成功后过滤软删、重新读真源和 baseline。未保存状态在关闭 / beforeunload 时必须阻止无提示离开。

### 后续分类、账户与 CSV

分类只能修改 Expenses / Income 的 `name` 与 `label` 注释；`label_path`、`brief` 为派生显示，不能新增 / 删除 open 行。账户只读展示 Assets / Liabilities，过滤 Equity。CSV 固定 10 列英文表头（含可选 `time`），逐行报错并校验账户；合法内容仅作为内存 Entry staging，必须交给同一 Finance Commit，不得直接写 bean。其 `time` 与 `seq` 排序契约同整理页；真实 Tauri 导入→保存→重开验收仍待完成。

## 4. Finance Service API 与模型

Service 是 FastAPI loopback API，不提供旧静态站根路由。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/health` | `{ ok: true, version: "0.0.17" }`；仅代表服务存活。 |
| GET | `/api/entries` | 按日期 / offset / limit 读取 write target。 |
| POST | `/api/validate` | Commit 前校验候选交易。 |
| POST | `/api/commit` | 按文件提交活跃交易；可 207 部分失败。 |
| GET | `/api/accounts` | expenses、income、assets、liabilities 四组。 |
| POST | `/api/categories/commit` | 受控 patch 分类。 |
| GET / PUT | `/api/settings` | 读取 / 更新相对 write target。 |

```ts
type Posting = {
  account: string; amount: number; currency: string;
  cost_amount: number | null; cost_currency: string;
};
type Entry = {
  id: string; source_file: string; source_line: number;
  type: "expense" | "income" | "transfer" | "inv";
  date: string; flag: string; payee: string; remark: string; tags: string;
  postings: Posting[]; seq: string;
};
```

`_is_new`、`_deleted` 和 `seq` 是前端内存状态，不进 API / bean；commit 必须过滤软删。`GET /api/entries` 返回 `entries`、`total`、`has_more`、`date_min`、`date_max`。

`POST /api/validate` 接收 `{ entries: Entry[] }`，至少校验类型、日期、flag、至少两条 posting、账户非空、amount 非零、单币种配平或多币种 `@@` 成本，以及 source file 等于当前 write target。

`POST /api/commit` 接收：

```json
{ "files": { "ledger/2026.bean": [/* active Entry[] */] } }
```

空 files / inv 文件为 400；全成功为 200；逐文件部分失败为 207。前端必须把 207 当失败结果处理，不能报“保存成功”。`/api/settings` 的 `write_target` 必须相对 bill 根；当前没有独立 UI 入口。

## 5. 存储不变量

- bean/Beancount 是用户可备份、可脱离 Orbita 使用的真源，不进 Git。
- Finance Parser 只读；Finance Commit 是常规写入唯一边界。
- 交易头、posting 缩进、数值格式、tags、`@@` 成本语法由 Parser / Commit 保持。
- `bkeasy-type: "..."` 是历史兼容 metadata，保留键名不代表保留产品名。
- Commit 必须在完整加载后提交当前活跃集合；不得以局部 UI 覆写整年文件。
- 新建骨架须用户触发；非空目录覆写须明确确认。

## 6. 阶段与验收

| 阶段 | 内容 | 当前状态 | 验收证据 |
| --- | --- | --- |
| 1 | Python Service、health、sidecar 生命周期 | 代码已落；待实机。 | Panel 不拉起；Insight 异步启动；退出清理；错误可行动。 |
| 2 | client 与初始记一笔 | 代码已落。 | 合法账本录入、确认、重开仍存在。 |
| 3 | 整理：阈值化渲染、编辑、时间排序、保存 | 自动化已通过；真实 Tauri 未完整验收。 | 10,000 内连续渲染 / 超阈值虚拟、同日时间顺序、状态机通过。 |
| 4 | 统计 MVP | 代码已落；待对账。 | 本月 / Top 分类与真源可解释一致。 |
| 5 | 分类 / 账户 | 代码保留，入口未定。 | 若开放，分类正确写注释，账户仍只读。 |
| 6 | CSV | 模板、解析、校验、staging 与自动化回归已落；真实 Tauri 未验。 | Tauri 导入、保存、重开后时间及顺序仍一致。 |
| 7 | 历史品牌 / 技术名清理 | 未做，非强制字符串替换。 | 单独兼容计划。 |

必测：

1. Panel 冷启动不启 Python；打开 Insight 时窗口不被 Service 阻塞。
2. 合法 `{dataDir}/bill` 可进入 Dashboard，账户非空。
3. 8000 有旧服务时，重试启动正确根的新服务，不认领旧进程。
4. 缺骨架显示未就绪；新建恢复；非空覆写需确认。
5. 切换空 dataDir 不显示旧数据；切回后 Service 读回旧根。
6. 新建、编辑、软删、改时间均走 validate → confirm → commit；失败不丢状态。
7. 10,000 条以内的筛选 / date pin / 异步全量加载不导致错写；超过阈值的虚拟渲染不改变排序或保存语义。
8. venv 缺失、端口耗尽、API 500 时显示可行动错误，绝不 fallback 错端口或伪造成功。

## 7. 不得回退的路线

- 不恢复六 tab 平铺；当前是 Dashboard + 钻取。
- 不恢复可编辑 Finance 根、`lifeRoot/bill` fallback 或 `{dataDir}/ledger` 根；当前唯一根为 `{dataDir}/bill`。
- 不在 boot、Panel 或 Agent 启动 Finance Service。
- 不复用未知 `/health` 端口上的孤儿服务；端口健康不等于数据根正确。
- 不将 Service 启动改为阻塞 Insight 显示。
- 不恢复独立历史主题、`localStorage.theme` 或长期 iframe。
- 不以产品改名理由修改 `docs_legacy/`、历史 spec 或用户账本。

## 8. 迁移背景

Finance 源于 0.0.17 前的 BKeasy 账本能力。旧交接和旧规格保留当时名称与事实；新开发只依赖本规格、`CURRENT.md`、`SYSTEM.md`、`DECISIONS.md` 与当前计划。本规格吸收旧 API、模型、交互和验收意图，并明确纳入后续 Dashboard IA、固定数据根、stale 检测、重试重启与未就绪页的现行结论。

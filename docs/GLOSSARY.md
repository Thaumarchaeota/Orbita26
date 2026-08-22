# Orbita 名称与术语契约

> **状态**：0.0.17-snapshot 现行术语。  
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
| **Orbita Journal** | 随记 | 每日、作息、餐食、随记等个人记录。 | 仅指日记；Journal 数据文件时需明确。 |
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
| TickTick connector | Orbita Work 的外部连接与数据来源 |

代码内部名称不应被自动批量重命名。只有当重命名的兼容性、配置、数据迁移、构建和运行验证都写入计划并完成验收后，才能修改。

## 8. 尚未定名的概念

以下概念尚未形成正式名称，禁止在文档中伪装成既定模块：

- 跨领域关联的正式产品名、数据模型和首个交互形态；Obsidian 双链只是类比。
- `archiveRoot` 的实际配置字段、目录布局和迁移时机。
- Knowledge、Media、Trail 等未来领域的正式 UI 名称与实现范围。
- Orbita Insight 内各领域区的最终导航结构与视觉名称。

这些概念进入实现前，应更新本文件并建立对应 plan；若影响长期边界，还应补充 `DECISIONS.md`。

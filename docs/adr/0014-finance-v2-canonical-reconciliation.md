# Finance v2：数据模型、处理边界与可追溯对账

- Status: Proposed
- Date: 2026-09-01

## 1. 目的与当前边界

本 ADR 是 Finance v2 的总设计入口，依次说明：数据由什么构成、每一类数据负责什么、各处理模块如何交接，以及哪些问题尚未定案。

它描述的是**目标设计**，不改变当前实现。当前 Finance 仍以用户可写的 `.bean` / Beancount 为唯一账本真源，Python Finance Service 负责 Parser / Commit；现行行为以 `docs/specs/orbita-finance.md` 为准。ADR 0011 也是以“每端可独立编辑 `.bean`”为前提的历史方案。

Finance v2 的目标是：

1. 各端本地 SQLite 是唯一可写、可同步的 Finance 真源；
2. 外部账单先保存为不可变 Observation，而不是直接改账；
3. 对账将多个来源观察与真实经济事件对应，再创建或维护最终 Transaction；
4. Transaction 以 Posting 表达会计事实；
5. 桌面端从 SQLite 确定性生成 `.bean`，供 Beancount 校验和报表读取；`.bean` 不再是日常写入口或同步对象。

```text
外部账单 / 手动记账
        │
        ├─ 外部账单 → Source Adapter → Observation（PC 本地、不可变）
        │                                  │
        │                                  ▼
        │                         Reconciliation / Resolution
        │                                  │
        └──────────────────────────────→ Transaction（SQLite 真源、Archive Object）
                                             └─ Posting（从属组件）
                                                        │
                                     通用 Sync Core ←───┼───→ 其他设备本地 SQLite
                                                        │
                                                        ▼
                                    桌面 materializer → `.bean` → Beancount
```

上图的“手动记账究竟直接创建 Transaction，还是先形成 Observation”尚未决定；它只说明无论入口如何，最终财务事实是 Transaction，而不是 `.bean` 或 Observation。

## 2. 数据结构与各自职责

### 2.1 结构总表

| 数据 | 身份与存储 | 作用 | 可否同步 / Connection |
| --- | --- | --- | --- |
| **Observation** | Finance Data；PC 本地 SQLite | 对一条外部来源流水的标准化、不可变观察，作为重复导入控制和对账证据。 | 不同步；不能进入 Connection。 |
| **Reconciliation / Resolution** | Finance 本地工作数据 | 记录 Observation 与真实经济事件、既有 Transaction 的候选、确认、重新打开与审计。 | 不同步；精确持久化结构未定。 |
| **Transaction** | `finance/transaction` Archive Object；各端本地 SQLite | 一笔最终确认的经济/会计事实，是账本、余额、跨域引用和同步的根。 | 同步；可由 `ArchiveRef` 加入 Connection。 |
| **Posting** | Transaction 从属 Component；各端本地 SQLite | 一笔 Transaction 内的会计分录，承担账户与复式记账约束。 | 仅随 Transaction 原子同步；不能单独进入 Connection。 |
| **账户、分类及映射** | Finance 领域数据 | 解释 Posting 归属、导入提示和用户记账结构。 | 精确模型与同步粒度未定。 |
| **`.bean` materialization** | 桌面端本地派生文件与 job 状态 | 从 SQLite Transaction / Posting 生成 Beancount 账本，供校验和报表读取。 | 不同步；文件路径、行号不是身份。 |

所有可同步 Finance 事实都先写入各端自己的 SQLite。Finance 不另设同步机制：Transaction 是 aggregate 根，全部 Posting 与它作为一个原子 aggregate 进入通用 Sync Core，由服务器校验并分发到其他设备。Observation、对账工作数据和桌面 `.bean` materialization 不进入 Sync。

### 2.2 Observation：外部流水的标准化观察

Observation 的职责是忠实、统一地保存“来源系统说发生了一条什么流水”。它不等于最终交易，也不承担账户归属、具体分类、Posting、退款关系或跨来源归并判断。

每条 Observation 独立、不可变且可审计：人工不能直接编辑它，归并后也不能删除它。若映射、账户提示或对账判断需要修正，应新增或调整相应的映射、Resolution 或最终 Transaction，并留下审计历史，而不是回写 Observation。

Observation 不保存原始时间文本、整份来源 payload、文件名、行页定位、导入顺序或其他逐行 provenance；CSV、XLSX、PDF 的版式差异只存在于 Source Adapter。账单文件本身始终只读。

| 字段 | 必填 | 含义与当前规则 |
| --- | --- | --- |
| `observationId` | 是 | SQLite 内部主键。其生成方式、来源唯一身份字段和用于重复导入的精确策略尚未定案；不得先假定为某个字段拼接或 canonical hash。 |
| `source` | 是 | 解析规则/adapter 的来源标识，例如支付宝、微信支付、招行借记卡、招行信用卡；由选中的 parser rule 给出，不是逐行字段。 |
| `occurredDate` | 是 | 来源业务日期。只有日期的账单以它为唯一可靠时间；有精确时刻时也保留，用于稳定表达来源业务日。 |
| `occurredAtUtc` | 否 | 仅来源有精确时分秒时写入的 UTC instant；为空表示来源只提供日期。 |
| `amount` | 是 | 来源表单金额，精度到人民币分。符号方向和货币表示的最终约定尚未决定。 |
| `currency` | 是 | 货币代码；当前四类账单一律为 `CNY`。 |
| `counterparty` | 否 | 交易对方；信用卡账单的交易摘要也在此承载。 |
| `description` | 否 | 商品或说明；目前来自微信、支付宝。 |
| `category` | 否 | 来源表单自带分类；目前仅明确支付宝“交易分类”写入此字段。 |
| `type` | 否 | 来源表单直接提供的交易类型或收/支性质。它只保留导入信息，不在 Observation 阶段推断最终 Transaction `type`、账户、分类或 Posting。 |
| `paymentMethod` | 否 | 来源表单提供的付款方式或付款账户提示，例如平台支付方式、银行卡尾号。它不是交易对方。 |

没有 `sourceAccountKey`、交易对方账号、交易订单号、商家订单号或备注等统一 Observation 字段；它们不能因为来源表中存在就被自动写入。是否未来需要来源专属扩展字段，仍是开放问题。

### 2.3 Transaction 与 Posting：最终账本事实

Transaction 是“这笔钱实际如何发生”的最终记录，也是 Finance 加入 Archive Connection 的唯一对象。它有稳定 UUID；`.bean` 文件路径、行号和渲染位置都只是派生定位，绝不充当 Object identity。

Posting 是 Transaction 的从属组件。它不单独成为 Archive Object、Connection Member、Sync cursor 或冲突卡片；一个 Transaction 及其全部 Posting 必须共同写入、共同校验、共同同步。账户、分类、最终交易 `type`、退款关系、删除/恢复、金额/commodity/cost/price/metadata 的精确字段与会计不变量仍待单独设计。

这条分界刻意保留：Observation 的 `type` 是外部来源给出的文本/枚举信息；Transaction 的 `type` 才是经过对账和记账后、服务于账户与复式记账的最终经济性质。二者不能混写，也不能在导入时互相替代。

### 2.4 期初、历史与 `.bean`

Finance v2 不迁移既有 `.bean` 账本。旧账本仅保留为只读备份；新的 SQLite 库以 **2025-09-01** 为初始化起点，通过可获得的账单导入重建历史，历史颗粒度以实际导出能提供的记录为准。

每个账户在初始化日的期初余额由用户手动填写，并创建明确、可回看的 Opening Balance Transaction；不依赖平台余额接口。首版重新建立账户与分类结构，不将旧 `.bean` 中的 Account、Category、`pad`、`balance` directive 当作第二真源：

- `pad` 不进入首版模型；
- 补齐期初或对账差额时，创建明确 Transaction；
- `balance` 如有需要，只能作为未来外部核对工具，不能自动补账或创造事实。

`.bean` 是从 SQLite 确定性生成的桌面端派生账本。`bean check` 只能证明派生账本被 Beancount 接受，不能证明导出语义正确；仍需要 SQLite 会计不变量、确定性导出和语义回读比对。SQLite 提交与文件替换不能组成同一原子事务，因此 materializer 必须在后续设计中具有持久 job、hash/manifest、失败重试与启动恢复语义。手改 `.bean` 若仍要支持，只能形成明确的导入/对账请求，不能自动覆盖 SQLite。

## 3. 处理模块与职责

### 3.1 Source Adapter：只做读取和机械标准化

Source Adapter 接收用户拖入的一个或多个账单文件。一次拖放是 UI 的导入批次、预览和错误范围，不是对账的匹配边界。Adapter 只读 CSV、XLSX 或可提取文字的 PDF，逐行/逐项填充 Observation，负责：

1. 识别适用 parser rule 并填 `source`；
2. 把来源日期/时间转为 `occurredDate` 与（如存在）`occurredAtUtc`；
3. 按本 ADR 的映射填写其余 Observation 字段；
4. 过滤已明确无效的来源记录；
5. 将候选 Observation 交给重复导入检查。

Adapter 不负责创建 Transaction、选择账户或分类、生成 Posting、自动归并、把信用卡账单版面分段伪装为字段，或从来源字段推断新业务含义。

#### 四类已核对账单的映射

除下表明确列出的时间标准化和“交易关闭”过滤外，不补写、不推断、不改变业务含义；未列出的源字段不写入 Observation。

| 来源表单 | 源字段 | Observation 字段 / 行为 |
| --- | --- | --- |
| 支付宝交易明细 | 交易时间 | 解析为 `occurredDate` 与 `occurredAtUtc`。 |
| 支付宝交易明细 | 交易分类 | `category`。 |
| 支付宝交易明细 | 交易对方 | `counterparty`。 |
| 支付宝交易明细 | 商品说明 | `description`。 |
| 支付宝交易明细 | 收/支 | `type`。 |
| 支付宝交易明细 | 金额 | `amount`。 |
| 支付宝交易明细 | 收/付款方式 | `paymentMethod`。 |
| 支付宝交易明细 | 交易状态 = 交易关闭 | 不创建 Observation。 |
| 微信支付账单 | 交易时间 | 解析为 `occurredDate` 与 `occurredAtUtc`。 |
| 微信支付账单 | 交易类型 | `type`。 |
| 微信支付账单 | 交易对方 | `counterparty`。 |
| 微信支付账单 | 商品 | `description`。 |
| 微信支付账单 | 金额(元) | `amount`。 |
| 微信支付账单 | 支付方式 | `paymentMethod`。 |
| 招商银行借记卡流水 | 记账日期 | `occurredDate`；没有精确时刻，不写 `occurredAtUtc`。 |
| 招商银行借记卡流水 | 交易摘要 | `type`。 |
| 招商银行借记卡流水 | 对手信息 | `counterparty`。 |
| 招商银行借记卡流水 | 交易金额 | `amount`。 |
| 招商银行借记卡流水 | 表头账号的后四位 | `paymentMethod`。 |
| 招商银行信用卡账单 | 交易日 | `occurredDate`；没有精确时刻，不写 `occurredAtUtc`。 |
| 招商银行信用卡账单 | 交易摘要 | `counterparty`。 |
| 招商银行信用卡账单 | 人民币金额 | `amount`。 |
| 招商银行信用卡账单 | 卡号末四位 | `paymentMethod`。 |

四类账单当前均写 `currency = CNY`。招行信用卡的交易地金额暂不写入 Observation。支付宝未写入的字段包括对方账号、交易订单号、商家订单号和备注；其余来源中未列出的状态、单号、备注等也同样不写入。

### 3.2 Observation Store：重复导入控制与本地证据库

Observation Store 是 PC 本地维护的 SQLite 表及其查询。它负责保存成功导入的 Observation，并阻止**同一来源流水**因重复选择同一文件或重叠导出区间而重复入库。

这与“是否已经记过这笔钱”完全不同。前者是同源流水的重复导入问题；后者是 Transaction / 对账问题。当前尚未决定来源唯一身份字段、`observationId` 的构造和招行 PDF 的 fallback，因此不得以日期、金额或文本相同就草率合并 Observation。

### 3.3 Reconciliation / Resolution：把观察与经济事件对应

Reconciliation 处理跨来源和手动记录的“是不是同一个真实经济事件”，而不是销毁重复 Observation。它的工作空间同时包含：

- 本次真正新增、尚可参与对账的 Observation；
- SQLite 中既有、尚可参与对账的 Observation；
- SQLite 中既有的 Transaction，不论它最初来自另一条 Observation 还是手机手动录入。

因此不存在“先批内、再跨批”的不同语义。候选关系可以是 1:1、1:N、N:1 或 N:M；例如多笔支付平台明细可与一条信用卡总额记录共同指向一笔 Transaction。

Reconciliation 可以利用付款方式、卡尾号等账户提示先缩小候选支付账户，再用金额（含组合求和）、时间、订单号、商户、摘要等作确定性匹配。低置信度才交由人工或 AI 辅助；高风险归并必须能人工确认、审计和回滚。AI 不能静默创造最终 Transaction。

归并不让任一 Observation 覆盖另一条。Transaction 的展示性商户/摘要等信息可从已归并成员按字段规则派生：通常支付平台提供更丰富的商品/收款信息，银行卡流水提供支付账户与资金出口证据；后加入成员可补全未人工覆盖的展示字段，不能仅由导入先后决定。通用手工 override 是否持久化，仍未定。

退款不会因为被识别为退款而从 Observation 消失：它首先仍是一条独立、等价的来源 Observation。退款最终如何成为 Transaction `type`、是否需要显式关联原交易，属于 Transaction / Reconciliation 的后续模型，不在 Adapter 或 Observation 阶段猜测。

### 3.4 Ledger Write：创建和维护最终 Transaction

Ledger Write 是唯一能创建、更新、删除/恢复最终 Transaction 及其 Posting 的 Finance 写入边界。它消费经用户确认或规则可证明的 Resolution，也将未来的手动记账入口写入同一最终模型。

它负责执行账户、分类、最终 `type`、Posting 平衡、退款、期初余额及审计等 Finance 领域约束。它不修改已存在的 Observation，不把导入批次当 Transaction 身份，也不让 Adapter、AI、Sync 或 `.bean` 文件绕过它直接改账。

具体 Transaction / Posting schema、账户树、分类模型、规则映射与操作 UX 仍待设计，因此本 ADR 不把“收/支/转账/退款”的最终枚举或任何自动账户归并写死。

### 3.5 Sync Core：同步最终事实，不同步本地工作数据

Sync Core 是通用 Archive 同步机制，不是 Finance 专用服务。它只传 `finance/transaction` aggregate 的规范化、版本化快照：Transaction 与全部 Posting 原子提交、原子校验、原子下发；服务器负责协议校验、历史、冲突和设备分发。Finance 领域较复杂的部分——对账、会计不变量和 `.bean` 派生——留在 Finance 自己的领域层。

Observation、导入批次、Reconciliation 工作状态、候选评分、本机文件、缓存、outbox、凭据和 `.bean` materialization 都不进入该 aggregate，也不随手机同步。其他设备不依赖 Observation 才能展示账本、余额或历史。

### 3.6 Materializer：SQLite 到 Beancount 的单向派生

Materializer 只在桌面端工作：读取已提交的 Transaction / Posting，确定性地产生 `.bean`，然后交由 Beancount 校验和报表读取。它是单向派生，不拥有新的 Finance 事实，也无权把 `.bean` 的变化直接写回 SQLite。

## 4. 已拒绝的路线

1. **继续以 `.bean` 为真源、SQLite 仅作缓存**：拒绝，无法自然支持跨端同步、稳定 Transaction ID 与可追溯的半自动对账。
2. **SQLite 与 `.bean` 双真源**：拒绝，会重新引入冲突、回写和无损文本合并问题。
3. **归并后自动丢弃 Observation**：拒绝，失去核对、纠错、规则改进与审计依据。
4. **为 Finance 单独设计 Sync Core**：拒绝，Finance 复用所有可同步 Object 的通用 aggregate / Sync Core；其复杂性属于领域层。

## 5. 尚未决定的事项

以下项目不能由实现者自行补全：

1. Observation 的来源唯一身份、`observationId` 构造、各来源状态枚举，以及招行 PDF 的 fallback 重复导入规则。
2. `sourceCategory` 是否需要独立字段；`paymentMethod` 的最终跨来源覆盖范围；是否保留来源专属字段。
3. Transaction / Posting 的精确字段、账户与分类结构、账户映射、删除/恢复、会计不变量与 aggregate 细节。
4. 最终 Transaction `type` 枚举，以及它和账户、分类、Posting、转账、退款与归并的关系。
5. Reconciliation 的持久化模型、候选评分/组合匹配、确认/重新打开/审计历史、自动化与人工确认阈值。
6. 日期只有日精度时的归并窗口；没有明确时区的账单在导入时如何选择 Business Time Zone。
7. 手动记账（尤其手机端）是直接写 Transaction 还是也形成 Observation；首次导入、期初余额、导出覆盖范围和导入完成的对账标准。
8. 精确金额、commodity、cost、price 与 metadata 的 SQLite 表达；不得使用浮点数或把“两位显示”误当数据模型。
9. materialization 失败/崩溃的用户状态、重试与恢复，以及既有 Candidate → Validate → Confirm → Commit 交互如何迁移。

在这些问题进入实现前，必须另立计划并完成相应的 L3 数据、迁移、同步与用户验收设计。

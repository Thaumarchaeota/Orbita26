# Orbita Finance：已定案

> 本文件使用现行术语。BKeasy 仅在历史证据或迁移背景中保留原名。

## 1. Finance 的边界与命名

**当前结论**：用户面对的是 **Orbita Insight · Finance**。Finance 是交易、账户、分类、资产、负债与未来预算的领域总名；“资产”是其中的视图/指标，“记账”是用户动作，Ledger 是内部账本模型。

**禁止回退**：不得将 BKeasy 作为可见产品、独立入口或长期 iframe 页面；不得将“资产”或“记账”重新用作整个领域的名称。

**当前技术映射**：现有 `integrations/ledger/`、`ledger_sidecar` 与 Python `ledger` 目录仍是技术实现名，不能据此反推产品名称。对外称 Finance Service；其当前形态是 Python sidecar。Parser 负责读取/解析账本，Commit 是校验后的受控写入边界。

**历史证据**：legacy HANDOFF §25.0.31、§25.0.39；旧 ledger spec A、C、D、F。

## 2. 数据根与存储格式

**当前结论**：Finance 当前根固定为 `{dataDir}/bill`，仅支持扁平 bean 布局：

```text
{dataDir}/bill/
  account.bean
  category.bean
  ledger/2026.bean
  .bkeasy/settings.json
```

bean / Beancount 是当前 Finance Storage，不是产品名称。Finance Parser 必须按该布局读数据，Finance Commit 必须保持追加/提交语义；不得用全量覆盖写替代受控提交。

**禁止回退**：不得恢复 `{dataDir}/ledger`、`journal.dataRoot/bill`、可编辑的旧 Finance 根、`account/` + `ledger.md` 或其他旧多目录布局。选择 `bill` 本身作为 `dataDir` 会造成 `bill/bill`，应提示用户选择父目录。

**未来边界**：未来 `archiveRoot` 的物理分离不改变本条当前事实；在另立迁移计划前，禁止移动 Finance 数据。

**历史证据**：legacy HANDOFF §25.0.31.1、§25.0.39.4、§25.0.40.1–.4。

## 3. Finance Service 生命周期

**当前结论**：Panel、Agent 与应用启动不启动 Python。当前 Insight 入口会 fire-and-forget 地确保 Finance Service 启动；窗口必须立即显示，不能等待健康检查。服务只在“本进程追踪的 child 存活 + 数据根与当前 dataDir 一致 + health 正常”时复用。

服务使用项目 venv Python（或明确 `ORBITA_PYTHON`），监听 loopback 的可用端口 8000–8010。数据目录切换、child 丢失、根目录不一致或仅残留 port 时，均视为 stale：停止旧 child、重启服务，再由 UI 重连。

**禁止回退**：不得在 app boot 启动服务；不得阻塞 Insight 打开；不得吞掉启动错误、回退系统 Python、前端猜测 `127.0.0.1:8000`，也不得因任意端口 health 成功就“收养”旧 uvicorn。重试必须重启 Finance Service，不能只重置前端 URL。

**根因**：旧实现错误复用带旧数据根的孤儿 uvicorn，health 成功但账户为空，页面误报未就绪；旧“重试”只 reconnect，永远连回错误进程。

**历史证据**：legacy HANDOFF §25.0.31.3、§25.0.32、§25.0.36.3、§25.0.39.5–.6、§25.0.40.2–.6。

## 4. Insight · Finance 的信息架构

**当前结论**：Finance 默认页是 Dashboard Hub；用户可钻取统计、明细/整理和导入。明细是顶栏筛选、列表和右侧录入；分类/账户代码可保留，但目前不是主导航，也不塞进 Insight 设置。当前 Dashboard 指标和最近交易仍可占位。

**禁止回退**：不得恢复旧六个平铺子导航、首页记一笔、Finance 内左侧筛选栏，或仅因发现已有 categories/wallets 模块而擅自增加入口。Panel 快速记一笔、CSV、分类/账户入口和完整 Dashboard 指标均是未来明确立项事项。

**实现陷阱**：shell view 使用 keep-alive / `hidden` 切换；`activeView` 初值必须为 `null`，否则首次 Dashboard 切换会被短路成白屏。

**历史证据**：legacy HANDOFF §25.0.33、§25.0.39.1–.2、.9–.10。

## 5. 账户选择

**当前结论**：所有 Finance 单选账户场景共用可配置 `AccountSelect`；调用方以根集合收窄范围。它使用贴邻的级联菜单：宽范围先列根，指向一项在右侧展开下一层；单根场景直接从该根的下一层开始。搜索改为单列的全路径结果模式，清空后回到级联浏览，第一版只按全路径做大小写不敏感的包含匹配。仅无子项且已 `open` 的账户可选。宽范围允许 Assets、Liabilities、Equity、Income、Expenses 五根，并允许 Equity posting；校验仍只限 Assets 或 Liabilities 单根。筛选多选 `AccountTreeMultiPicker` 完全排除在本次改动范围外。

**禁止回退**：不得因范围为 1/2/5 根而分别创建公开单选组件；不得把单选级联菜单与筛选的多选/半选树混为同一产品语义。历史上已写在父账户的分录不作迁移、删除或账本校验；触发器可兼容回显该旧值，编辑其他字段时保持它，限制只适用于新的选择动作。

**叶 `open` 边界**：当前 Finance 编辑仅由选择器禁止新的父账户选择，Finance Commit 不追溯扫描或拒绝历史父账户分录。未来账户创建/管理入口必须阻止新建会成为父节点的 `open` 账户；本条不授权迁移、清理或全量校验已有账本。

**显示边界**：默认以账户批注名/友好路径为主、完整 `.bean` 名为灰色次行；搜索匹配两者。明细 posting 行内编辑与 Composer 高级的五根管理员模式中，已选值本体框固定显示完整 `.bean` 路径，以对齐现有条目；菜单开关和选择态不得造成文字、行高或布局跳动。详见 [ADR 0004](../adr/0004-finance-account-select-cascade-menu.md)。

**Equity 边界**：Equity 仅在明细 posting 行内编辑和 Composer 高级中可选。简易 Composer 保持日常收支/转账语义：支出为 Expenses + Assets/Liabilities，收入为 Income + Assets，转账两端均为 Assets/Liabilities。

**详细决策**：[ADR 0004](../adr/0004-finance-account-select-cascade-menu.md)。

## 6. 写入与 AI

所有 Finance 写入——UI、导入或未来 AI——都必须经过 Finance Commit 的校验与提交语义。Agent 当前只能摘要读取，不能伪装为已可写账。非空目录的新建/覆写必须有明确确认。

**历史证据**：legacy HANDOFF §25.0、§25.0.31、§25.0.40；旧 ledger spec F、H。

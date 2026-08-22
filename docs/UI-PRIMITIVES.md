# Orbita 可复用 UI 与动效原语目录

> **用途**：这里只登记已在跨场景复用、或已经被确认并纳入当前计划的 UI 原语；它不是组件愿望清单，也不是设计系统的提前承诺。
>
> **状态口径**：`已实现`表示代码与当前调用点均存在；`计划中`表示产品边界已确认、实现尚未开始或尚未验收；`未登记`表示局部样式或单页逻辑，不得因名称相似而被当作公共能力。计划状态与真实验证以 [CURRENT.md](CURRENT.md) 和对应 plan 为准。

## 维护边界

- 原语只负责可复用的呈现、交互或动效机制；筛选语义、草稿、状态机、业务校验与写入归所属领域管理。
- 只有至少两个独立调用场景已经存在，或当前计划已明确要求提取且写明边界时，才可在本目录登记。局部 CSS、一次性 DOM 拼装和仅服务单卡片的动效不升级为原语。
- 新增、移除或改变原语的公开 API、状态或调用点时，同一工作项必须更新本目录；同时更新对应 plan 的范围/验收。若改变当前真实行为、风险或验证状态，还必须更新 [CURRENT.md](CURRENT.md)。
- `计划中`条目不得被实现者视为现成组件；落地后必须把它改为`已实现`，列出真实调用点、测试/验证证据，并删除未发生的设想。
- 当前 Finance 工作台设计的完整追溯源是 [v0.0.17 Finance 壳层流畅化与可信完成反馈](plans/v0.0.17-finance-shell-responsiveness.md#15-live-decision-log--finance-workspace-redesign)。本目录只抽取其中与复用边界有关的事实。

## 已实现

| 原语 | 负责 / 不负责 | 真实调用或来源 | 状态 |
| --- | --- | --- | --- |
| `motion.ts` 的 Popover / Dialog motion | 从触发点设置动效原点、打开/关闭浮层和 dialog、尊重 reduced motion；不管理具体字段、焦点语义或业务状态。 | `orbita/src/ui/motion.ts`；依赖 `modal-root`。 | 已实现；调用点随各页面 dialog/popover 而变，新增调用须登记。 |
| `action-motion.ts` + `theme-action-motion.css` | 操作按钮的 pending、成功勾、错误和拒绝 shake 反馈；不定义何时业务上成功。 | 通用 UI action motion；Finance 保存的“何时显示绿勾”受 ADR 0003 约束。 | 已实现。 |
| `LoadingIndicator` | 主题适配的统一加载几何、速度、reduced-motion 与无障碍状态；提供按钮内紧凑样式和内容区局部样式，不阻断整页。 | `action-motion` 的按钮 pending、Finance 校验结果区及未来局部异步反馈。 | 计划中；现有按钮 spinner 不能误称为此原语已完成。 |
| `layout-flip.ts` | 对稳定、固定宽度目标做单轴 FLIP 平移；处理连续切换、取消、卸载和 reduced motion；不得用于卡片列表每项或虚拟列表内部节点。 | `orbita/src/ui/layout-flip.ts`；Finance 主体重居中与 Admin 侧栏开合。 | 已实现；见 [ADR 0003](adr/0003-perceived-responsiveness-and-durable-completion.md)。 |
| `card-surface-motion.ts` | 卡片视觉状态的 paint 过渡与诊断；不提供跨页面的卡片组件或通用布局动画。 | Finance `CardDetailSurface`。 | 已实现，但仍是 Finance 专用，不可当作公共 card primitive。 |
| 现有 `mountAccountPicker` | Finance 单值账户选择与 portal 浮层；当前为“分组 + 账户”双列，不支持搜索、账户树、多选、父含子或可配置账户约束。 | `orbita/src/integrations/ledger/ui/account-picker.ts`；Finance Composer 及旧 Entry Form 系列。 | 已实现；下方的计划是受控扩展/替换，不可误称已满足新 AccountPicker 合约。 |
| 现有 `mountDatePicker` | 单日日期按钮、月历浮层与 `YYYY-MM-DD` 值；当前不支持单触发器日期范围或快捷范围。 | `orbita/src/ui/date-picker.ts`；Finance Composer、详情筛选、旧 Entry Form 系列。 | 已实现；下方的计划是受控扩展/替换，不可误称已满足新 DatePicker 合约。 |

## 计划中：已确认、尚未实现的 Finance 原语

这些条目均来自 Finance 壳层计划 §1.5。带“扩展”的条目已有较窄的单值实现，但本节所述能力尚未存在；其余条目尚无可用调用点。

| 原语 | 已确认边界 | 计划调用场景 | 状态 |
| --- | --- | --- | --- |
| `AccountTreeMultiPicker` | 账户筛选专用的可搜索层级复选树，提供普通级联勾选、父级半选与“父账户含子账户”范围语义；不持有筛选状态。 | 右栏筛选：全账户、无上限多选、OR/AND。 | 计划中。 |
| `AccountSelect` | 精确账户目标专用的可搜索单选器；只允许选择实际存在且当前场景允许的账户，父级目录仅作导航/分组，不能作为聚合目标。 | 校验：资产与负债/信贷单选；Composer：各账户字段单选，继续服从既有交易类型规则。 | 计划中。 |
| `SearchableSelectPopover` | 单层“搜索框 + 平铺选项列表”的基础选择浮层，统一选中态、空状态、最大高度、隐藏滚动条和键盘行为；不承载树、日期或业务匹配语义。 | `TagPicker` 及将来同类平铺选择。 | 计划中。 |
| `TagPicker` | 复用单层可搜索选择器，提供无限多选与可移除已选项；已选较多时显示前几个标签与“+N”摘要；不与账户树强行共用实现。 | 右栏筛选：默认任一标签（OR），可切换为同时包含（AND）。 | 计划中。 |
| `DatePicker` 扩展 | 在现有单日选择器基础上，统一单日/范围输入格式、日历浮层与即时格式校验；不持有筛选或校验状态。 | 筛选与校验：单一日期范围触发器，同一浮层选起止；Composer：沿用单日能力。筛选默认“全部时间”，快捷范围为今天、近 7 天、本月、今年、全部时间。 | 计划中。 |
| `TimePicker` | 统一 `HH:mm` 输入、小时与分钟快捷面板、即时合法性校验；不改变时区、metadata 或写入链路。 | Composer 及其他现有时间输入。面板分钟为 `00 / 15 / 30 / 45`，仍可直接键入任意严格合法 `HH:mm`；不使用浏览器原生时钟图标。 | 计划中。 |

## 已确认的 Finance 工作台调用规则（未实现）

以下是原语落地时不可改变的产品边界，完整细节以该 plan 为准：

- 右栏为固定 `360px` 的占位式工作台，自上而下为“筛选 / 添加 / 校验”；日历和账户树为不撑高右栏的浮层。右栏过高时可独立纵向滚动，但滚动条永久视觉隐藏、不占宽度，且仅在确有溢出时显示不参与布局的渐隐提示。
- 筛选即时生效，无应用按钮。账户多选默认“任一账户”（OR），可切换“同时包含”（AND）；父账户包含子账户。标签同样多选，默认 OR、可切换 AND。金额筛选不在本轮范围内。
- 校验只允许单选资产与负债/信贷账户；默认跟随筛选日期（可关闭后使用独立日期范围）。无日期显示当前余额；有日期显示期初、流入、流出、净变动、期末和笔数。
- Composer 只改变 UI 入口：从右栏移至受管理 modal/dialog。其字段、默认值、校验、草稿、状态机、Candidate、Commit、绿色成功语义与提交后流程均不改变；提供取消、保存、保存并继续记一笔。
- 轻量顶栏保留页面 chrome、保存、侧栏开关与 Finance 搜索。`Ctrl/Cmd + F` 搜索当前结构化筛选结果但不改变列表集合、排序或滚动状态；范围为全部 / 收款人+摘要 / 账户 / 标签 / 金额。只索引业务结构字段与币种，不搜索 Beancount 语法、flag、link、内部 metadata 或日期/时间。命中按交易计数，并支持 Enter / Shift+Enter 定位与 Esc 清除。
- 所有保存反馈继续遵循 [ADR 0003](adr/0003-perceived-responsiveness-and-durable-completion.md)：原子 Commit 后才显示绿勾；reload、统计和测量是受 generation 守卫的后台派生工作，不能阻塞或撤销已确认的核心完成。

## 暂不登记为原语

- Finance 各页面中散落的 hover、展开、卡片与布局 CSS：除非形成已验证的跨场景 API 和调用点，否则它们只是局部实现。
- TickTick 的 `form-pickers.ts` 日期/时间控件：目前是该集成的局部实现，不应被 Finance 当作通用 `DatePicker` / `TimePicker` 复用。
- 未来金额筛选、泛化账本查询或新的浏览页：尚未定义足够的产品语义，不能提前占用组件或原语名称。

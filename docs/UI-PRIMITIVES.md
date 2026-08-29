# Orbita 可复用 UI 与动效原语目录

> **用途**：这里只登记已在跨场景复用、或已经被确认并纳入当前计划的 UI 原语；它不是组件愿望清单，也不是设计系统的提前承诺。
>
> **状态口径**：`已实现`表示代码与当前调用点均存在；`已写未接线/未验收`表示代码与单测已落但尚无业务调用点；`计划中`表示产品边界已确认、实现尚未开始或尚未验收；`未登记`表示局部样式或单页逻辑，不得因名称相似而被当作公共能力。计划状态与真实验证以 [CURRENT.md](CURRENT.md) 和对应 plan 为准。

## 维护边界

- 原语只负责可复用的呈现、交互或动效机制；筛选语义、草稿、状态机、业务校验与写入归所属领域管理。
- 只有至少两个独立调用场景已经存在，或当前计划已明确要求提取且写明边界时，才可在本目录登记。局部 CSS、一次性 DOM 拼装和仅服务单卡片的动效不升级为原语。
- 新增、移除或改变原语的公开 API、状态或调用点时，同一工作项必须更新本目录；同时更新对应 plan 的范围/验收。若改变当前真实行为、风险或验证状态，还必须更新 [CURRENT.md](CURRENT.md)。
- `计划中`条目不得被实现者视为现成组件；落地后必须把它改为`已实现`，列出真实调用点、测试/验证证据，并删除未发生的设想。
- 当前 Finance 工作台的活动收束入口是 [0.0.17 收束总计划](plans/v0.0.17-closeout.md#4-finance-ui-与工作台)；本目录只抽取其中与复用边界有关的事实。持久交互护栏以 ADR 0003 与 `decisions/interaction.md` 为准。

## 已实现

| 原语 | 负责 / 不负责 | 真实调用或来源 | 状态 |
| --- | --- | --- | --- |
| `motion.ts` 的 Popover / Dialog motion | 从触发点设置动效原点、打开/关闭浮层和 dialog、尊重 reduced motion；不管理具体字段、焦点语义或业务状态。 | `orbita/src/ui/motion.ts`；依赖 `modal-root`。 | 已实现；调用点随各页面 dialog/popover 而变，新增调用须登记。 |
| `action-motion.ts` + `theme-action-motion.css` | 操作按钮的 pending、成功勾、错误和拒绝 shake 反馈；不定义何时业务上成功。 | 通用 UI action motion；Finance 保存的“何时显示绿勾”受 ADR 0003 约束。 | 已实现。 |
| `layout-flip.ts` | 对稳定、固定宽度目标做单轴 FLIP 平移；处理连续切换、取消、卸载和 reduced motion；不得用于卡片列表每项或虚拟列表内部节点。 | `orbita/src/ui/layout-flip.ts`；Finance 主体重居中与 Admin 侧栏开合。 | 已实现；见 [ADR 0003](adr/0003-perceived-responsiveness-and-durable-completion.md)。 |
| `card-surface-motion.ts` | 卡片视觉状态的 paint 过渡与诊断；不提供跨页面的卡片组件或通用布局动画。 | Finance `CardDetailSurface`。 | 已实现，但仍是 Finance 专用，不可当作公共 card primitive。 |
| 现有 `mountDatePicker` | 单日日期按钮、月历浮层与 `YYYY-MM-DD` 值；当前不支持单触发器日期范围或快捷范围。 | `orbita/src/ui/date-picker.ts`；Finance Composer。 | 已实现；`DateRangePicker` 为范围扩展。 |
| `SearchableSelectPopover` | 单层“搜索框 + 平铺选项列表”，统一选中态、空态、最大高度、隐藏滚动条与键盘（↑↓/Enter/Esc）；不承载树或业务语义。 | `orbita/src/ui/searchable-select-popover.ts`；`TagPicker` 内部。 | 已实现。 |
| `TagPicker` | 复用 `SearchableSelectPopover`，无限多选与可移除 chips；已选较多时显示前几个与 `+N`。 | `orbita/src/integrations/ledger/ui/tag-picker.ts`；`finance-rail-filter.ts`。 | 已实现。 |
| `LoadingIndicator` | 主题适配的统一加载几何、速度、reduced-motion 与无障碍状态；提供按钮内紧凑样式和内容区局部样式，不阻断整页。 | `orbita/src/ui/loading-indicator.ts`；`finance-rail-audit.ts`。 | 已实现。 |
| `DateRangePicker` | 单触发器日期范围、两段式日历点选（首击单日即时生效、反向第二点重定起点、快捷范围）；不持有筛选状态。 | `orbita/src/ui/date-range-picker.ts`；`finance-rail-filter.ts`、`finance-rail-audit.ts`。 | 已实现。 |
| `TimePicker` | 统一 `HH:mm` 输入、小时与 `00/15/30/45` 快捷面板、即时合法性校验（`:60` 不可写）；不改变时区或写入链路。 | `orbita/src/ui/time-picker.ts`；`cds-composer.ts`（Composer modal）。 | 已实现。 |
| `AccountSelect` | 精确账户目标专用的可搜索单选器；合成父目录不可选，账本已声明父账户可选（ADR 0004）。 | `orbita/src/integrations/ledger/ui/account-select.ts`；`cds-composer.ts`、`cds-composer-advanced.ts`、`cds-editing.ts`、`finance-rail-audit.ts`。 | 已实现；用户 2026-08-30 验收。 |
| `AccountTreeMultiPicker` | 账户筛选专用的可搜索层级复选树，普通级联勾选、父级半选；不持有筛选状态。 | `orbita/src/integrations/ledger/ui/account-tree-multi-picker.ts`；`finance-rail-filter.ts`。 | 已实现。 |

## 已落地的 Finance 工作台规则

以下规则已在生产路径 `views/detail/index.ts` 落地；持续护栏见收束总计划 §4.2 与 `specs/orbita-finance.md`：

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

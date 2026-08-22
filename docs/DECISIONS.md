# Orbita 已定案

> 这里是当前仍有效的审查护栏入口，不是实现状态、计划或事故流水。  
> 审查、重构或提出替代方案前，先读与改动领域相应的文件；不得仅因“更统一 / 更现代”而恢复已被验证否决的路线。

| 领域 | 文件 | 何时必读 |
| --- | --- | --- |
| Panel / Insight、窗口、弹窗与交互 | [`decisions/surfaces.md`](decisions/surfaces.md) | 改窗口、标题栏、click-through、弹窗、拖拽或主界面布局前。 |
| 全局交互响应、成功反馈与高成本布局动画 | [`decisions/interaction.md`](decisions/interaction.md) | 改异步操作状态、绿色勾、后台刷新、侧栏、滚动区或长列表动画前。 |
| Archive、数据目录、隐私与连接 | [`decisions/data.md`](decisions/data.md) | 改数据根、设置、迁移、Journal、外部协议或隐私边界前。 |
| Orbita Health、Garmin、AI、Work | [`decisions/integrations.md`](decisions/integrations.md) | 改同步、Agent、TickTick、AI 流式或健康记录前。 |
| Orbita Finance | [`decisions/finance.md`](decisions/finance.md) | 改 Finance UI、账本格式、Parser、Commit、Service 或数据目录前。 |
| 开发运行时与兼容性 | [`decisions/runtime.md`](decisions/runtime.md) | 改启动、dev、唤醒、capability、图标或外部打开方式前。 |
| 旧数据与平台兼容 | [`decisions/compatibility.md`](decisions/compatibility.md) | 清理旧模块、改设置迁移、图标、协议或文件选择器前。 |

## 使用规则

- 已定案不等于永久禁止。若产品目标、底层格式或真实运行环境已改变，先在 plan 中说明旧结论为何不再适用、迁移和回归方式，再由用户确认。
- 每条护栏应包含当前结论、禁止回退项、根因/理由和本地历史证据定位；不要把完整事故经过复制到这里。
- 完整事故时间线属于 `HISTORY.md`；当前事实属于 `CURRENT.md`；具体实现范围属于 `plans/` 或 `specs/`。
- `docs_legacy/` 是原始历史证据，保持不改；现行文档必须独立足以指导当前工作。

# Orbita 文档

> 文档与计划收束基线：`0.0.17-closeout`；代码版本基线仍为 `0.0.17-snapshot`。  
> 代码版本以 manifest 为准；当前实现状态以 `CURRENT.md` 为准；当前工作范围以 `plans/` 中的计划为准。

`0.0.17-closeout` 是 0.0.17 的收束总计划（2026-08-30 文档与实现收束完成）；`0.0.17-snapshot` 仍表示代码基线，不是正式发布版本号。`plans/` 中其他文件（如 0.0.18 讨论草案）不是 0.0.17 执行输入。

## 从这里开始

日常开发、审阅，或 AI 接手任务时，按下列顺序阅读：

1. 本文件：了解文档边界与维护规则。
2. [AGENTS.md](AGENTS.md)：AI 协作、测试与进程护栏（完整版）。
3. [GLOSSARY.md](GLOSSARY.md)：确认 Panel / Insight / Archive / Finance 等现行名称。
4. [CURRENT.md](CURRENT.md)：确认当前真实状态、已知问题与下一步。
5. 当前计划：
    - [0.0.17 收束总计划](plans/v0.0.17-closeout.md)：0.0.17 收束记录（2026-08-30 完成）；§4.1 运行时项仍开放。
    - 已结束、取消或被替代的过程计划见 [plans/archive/](plans/archive/README.md)，只供追溯，不作为实现输入。
6. [DECISIONS.md](DECISIONS.md)：审查、重构或提出替代方案前，先排除已否决路线。
7. [ADR](adr/README.md)：评估或提出新的重要产品、架构与数据取舍时，了解待确认决策与记录格式。
8. [SYSTEM.md](SYSTEM.md)：涉及架构、数据模型、迁移或 sidecar 时阅读。
9. [DEV.md](DEV.md)：需要运行、调试或验证时阅读。
10. [数据架构演进方向](architecture/data-layer-vision.md)：设计 Archive、Insight 或跨领域关联时阅读。
11. [可复用 UI 与动效原语目录](UI-PRIMITIVES.md)：新增跨场景控件、浮层或动效前，确认应复用什么以及真实调用点。

## 当前基线

- 一个 Orbita：Orbita Panel（代码 `main`）与 Orbita Insight（代码 `admin`）是两个窗口，不拆成第二个应用。
- Orbita Insight 有健康、随记、财务、工作四个领域区；当前代码 id 为 `health | journal | finance | work`。
- Orbita Archive 是长期个人档案数据域；当前物理上仍与 App State 共用 `dataDir`。
- Finance Service 不在 Orbita Panel 启动；当前代码在 Orbita Insight 入口异步确保它启动，Finance 页面使用该服务。若要收窄为仅进入 Finance 才启动，须先另立计划并验收生命周期与错误体验。
- 本阶段不做手机端、NAS 前置，以及今日区的 7 日切换。

上述内容是当前产品口径的摘要。实现进度、遗留项和验证结果必须写在 `CURRENT.md`，不要在这里重复维护。

## 文档职责

| 文件 | 只回答的问题 |
| --- | --- |
| `CURRENT.md` | 现在真实做到了什么、已知什么问题、下一步是什么？ |
| `GLOSSARY.md` | 现行产品、领域、数据与技术名称分别指什么？ |
| `SYSTEM.md` | 系统如何构成，哪些架构与数据约定不能随意破坏？ |
| `architecture/data-layer-vision.md` | 个人档案、跨领域关联与 Insight 的长期数据架构应如何演进？ |
| `specs/` | 已进入实施的领域细规格；当前见 `specs/orbita-finance.md` 与 `specs/orbita-journal-health.md`。 |
| `DECISIONS.md` | 哪些方案已被验证否决或明确拍板，为什么不能被审查建议随意恢复？ |
| `adr/` | 正在讨论或已确认的重要产品、架构与数据取舍，及其背景、替代方案和后果。 |
| `DEV.md` | 如何运行、调试、验证，以及可复用的排错经验？ |
| `UI-PRIMITIVES.md` | 哪些 UI/动效原语已真实可复用、哪些仅已确认待实现、各自在哪里调用且不能负责什么？ |
| `VISION.md` | Orbita 为何存在，长期方向与产品边界是什么？ |
| `HISTORY.md` | 重要改动、事故和关键取舍当时为何发生？ |
| `plans/` | 当前准备做什么、范围是什么、怎样验收？ |
| `plans/archive/` | 已收官、取消或被替代的计划；只供追溯。 |

`docs_legacy/` 是未迁移的原始交接资料；`reference/` 是本地外部参考资料。两者都不是当前项目的正式事实源，也不进入公开 Git。

## 维护规则

只在信息变化时更新对应文档，不要求每次 commit 都修改全部文档。

| 发生的变化 | 必须更新 | 视情况更新 |
| --- | --- | --- |
| 局部 bug、样式或布局修复，且不改变稳定交互/数据约定 | 无 | 在代码或经用户许可的提交说明中留下必要上下文；不要追加流水账。 |
| 开始一项有明确范围的工作 | `plans/` | `CURRENT.md`（当前焦点变化时） |
| 代码实现完成 | `CURRENT.md` | 当前计划中的验收/状态 |
| 形成长期架构或数据约定 | `SYSTEM.md` | `HISTORY.md`（记录取舍原因） |
| 改变已有领域的数据、写入或同步契约 | 对应 `specs/` | `SYSTEM.md`、当前计划 |
| 确认一条不能被随意恢复的交互/架构路线 | 对应 `decisions/` | `HISTORY.md`（根因重要时） |
| 需要由维护者确认的重要产品、架构或数据取舍 | `adr/` | 确认后按需要将不可回退的护栏摘要写入 `decisions/`、`SYSTEM.md` 或 `specs/` |
| 发现可复用的运行、调试或构建经验 | `DEV.md` | `HISTORY.md`（重要事故时） |
| 新增、移除或改变跨场景 UI/动效原语的公开边界、状态或调用点 | `UI-PRIMITIVES.md`、当前计划 | `CURRENT.md`（真实行为、风险或验证状态变化时） |
| 发生重要迁移、事故或关键取舍 | `HISTORY.md` | `CURRENT.md` |
| 计划收官、取消或延期 | 归档计划、更新 `CURRENT.md` | `HISTORY.md` |

功能代码与其必要的状态或计划文档应在同一 commit 中提交。纯文档迁移、历史整理或格式调整应单独提交，便于审阅。

## 计划归档

归档前必须如实标记任务，不能为了“归档好看”把未做事项勾成完成：

- `[x]`：已验收完成。
- `[-]`：部分完成，或方案发生实质变化。
- `[ ]`：未完成；须说明是取消还是延期。

每份归档计划都要有简短的 `Outcome`，至少写明：

- 状态：已收官、部分完成或已取消；
- 收官时间和代码基线；
- 实际交付；
- 未完成、取消或延期的内容；
- 后续计划链接（如有）。

完成后将计划移入 `plans/archive/`，不要删除。`HISTORY.md` 只写一段收官摘要并链接归档计划，不复制整份任务清单。

## 面向 AI 的协作规则

完整协作、测试、进程护栏与行为边界见 [AGENTS.md](AGENTS.md)。本文档只保留文档维护相关摘要：

- 开始实现前必须阅读本文件、`CURRENT.md`、`DECISIONS.md` 和当前计划；涉及架构或数据时还必须阅读 `SYSTEM.md`。
- 未经用户明确允许，AI 不得创建 Git commit、提交、推送、改写历史或执行其他 Git 写操作。
- 每次完成代码修改后，AI 必须运行 `orbita/dev.bat` 并确认无报错后方可结束对话（用户另有指示时除外）。
- 根目录 `AGENTS.md` 仅保留短入口；详细规则以 [AGENTS.md](AGENTS.md) 为准，避免两处漂移。

## 公开仓库边界

`docs/` 会进入公开 Git，但不得包含密钥、Cookie、账号信息、个人数据、未脱敏日志、本机私有路径，或外部资料原文。机密信息仅通过环境变量名、配置字段和脱敏示例说明。

`docs_legacy/` 保留原始 HANDOFF，直到有效内容完成迁移、公开内容完成脱敏审查，并由项目维护者确认不再需要原始项目记忆。它始终不应提交到公开仓库。

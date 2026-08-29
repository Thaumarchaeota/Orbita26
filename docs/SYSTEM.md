# Orbita 系统约定

> 本文件记录当前仍有效的系统边界与数据契约。未来数据架构方向见 `architecture/data-layer-vision.md`；不可回退结论见 `DECISIONS.md`。

## 1. 应用与界面

Orbita 是一个 Tauri 桌面应用、一个可执行文件、两个界面：

| 界面 | 代码窗口 | 职责 |
| --- | --- | --- |
| **Orbita Panel** | `main` | 日常进入、今日查看、快速记录、启动器、AI 与轻量工作操作。 |
| **Orbita Insight** | `admin` | 深入回看、整理、管理和分析；包含 Health、Journal、Finance、Work。 |

Panel 与 Insight 共享应用和数据，但不是彼此的加载入口。Insight 关闭的语义是隐藏并复用；新窗口、frame 或启动逻辑须遵循 `decisions/surfaces.md`。

### Insight Host

Insight Host 只拥有核心领域导航、缓存的领域 root、共享 chrome / modal 与生命周期；它不拥有领域数据或业务状态。当前 destination 固定为 Health、Journal、Finance、Work：普通切换只保存可恢复状态并 activate/deactivate、hide/show，保留 root；只有受控的 `dataDir` 切换才在领域 guard 通过后 dispose 并重建。Finance 仍独立拥有 Store、Commit、Service 连接和内部 keep-alive；Health、Journal、Work 目前仍是 placeholder。Insight 的显示不得等待 Finance Service。

## 2. 数据边界

当前 `dataDir` 是实际数据根，同时包含：

- **App State**：设置、主题、窗口、启动器、缓存、凭据与应用运行状态；
- **Orbita Archive 的早期数据**：Journal、Health/Exercise、Finance 等个人档案事实。

未来可能分为 `dataDir` 与 `archiveRoot`，但当前未分离。不得自行移动、复制、迁移或重命名用户数据。Archive 不是万能数据库：Journal、Finance、Health、Knowledge 与 Media 保留领域模型；详情见 `architecture/data-layer-vision.md`。

## 3. Journal 与 Health

Journal 按年存储结构化记录；`daily`、`routine`、`diary` 按 `date + kind` 覆盖，其他记录按 id 管理。默认时间语义为 `Asia/Shanghai`；跨午夜运动归开始日，`routine` 归醒来日。

Garmin 是 Orbita Health 的外部来源：同步保留领域数据与原始运动文件，daily 同步须 merge 本地 meals。认证、同步和睡眠等严格约束见 `decisions/integrations.md`。

## 4. Orbita Finance

Orbita Finance 是财务领域；资产是其中视图，记账是操作，Ledger 是内部账本模型。当前 Finance Storage 是 `{dataDir}/bill` 下的 bean/Beancount 文件；Finance Service 以本地 Python sidecar 运行。Parser 负责读取，Commit 是校验后的受控写入边界。

Finance Service、数据根、Dashboard 信息架构和写入规则的现行细节见 `decisions/finance.md` 与 `specs/orbita-finance.md`。

## 5. 前后端与外部集成

TypeScript 负责 UI、交互和局部状态；Rust 负责窗口、文件、进程、数据根与 Tauri command；Python Finance Service 负责当前账本服务。外部工具保留各自边界：Garmin 属于 Health 来源，TickTick 属于 Work 连接，Zotero/Obsidian 属于 Knowledge 连接。

AI、外部服务和写入行为必须遵守确认、来源和用户数据所有权边界。凭据、token、用户数据和缓存不进 Git。

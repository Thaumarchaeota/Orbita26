# Insight 实际架构对账

> **性质**：0.0.17 文档收束时的只读架构对账；描述已采用的结构与仍停留在计划层的边界，不是新的实现计划或验收记录。
>
> **范围**：Orbita Insight（代码窗口 label `admin`）的窗口、Host、领域 destination、设置入口与 Finance Service 启动边界。Finance 内部的账本 UI、数据与 Commit 语义不在本文重述。

## 1. 设计意图

0.0.17 将 Orbita 定义为单一 Tauri 应用、两个 webview 窗口：Orbita Panel（`main`）负责日常进入，Orbita Insight（`admin`）负责深入回看、整理、管理与分析。Insight 不是第二个应用，也不是一次性 tab 容器。

Insight Host 的目标是：

1. 使用自绘标题栏、左侧工作空间导航及内容 viewport，承载 Health、Journal、Finance、Work 四个领域。
2. 每个领域首次访问时 mount 一次；以后切换仅 deactivate/隐藏与 activate/显示，保留各自 DOM、滚动、局部路由与内存会话。
3. Host 只拥有导航、根容器、共享 chrome、共享弹层与生命周期；领域继续拥有自己的数据、业务 UI、错误和内部路由。Finance 在 Host 之下仍维持自己的 Shell / Layout / Chrome / Store / Surface 分层。
4. Insight 打开不可等待 Finance Service；Service 以非阻塞方式确保启动，Finance 自己在其领域根中表示 loading、未就绪或连接失败。
5. `dataDir` 是当前共同数据根，设置只能在 Insight 进入；切换前由领域 guard 处理未保存状态，切换后才销毁旧领域根、重启 Finance Service 并通知两个窗口。

这些意图来自 `docs/README.md`、`docs/GLOSSARY.md`、`docs/SYSTEM.md`、`docs/decisions/surfaces.md`、`docs/decisions/data.md` 与 `docs/plans/v0.0.17-insight-spec.md`。其中“一个应用、两个窗口”“隐藏后复用”“不阻塞等待 sidecar”也是 `docs/plans/v0.0.17-snapshot.md` 的明确范围。

## 2. 实际采用架构

### 2.1 进程与窗口壳

```text
Tauri application / one executable
├─ main webview window — Orbita Panel
└─ admin webview window — Orbita Insight
   └─ TypeScript Insight Host
      ├─ custom titlebar + global settings + frame overlay controls
      ├─ fixed core-domain sidebar
      └─ admin-content viewport
         ├─ cached Health root (placeholder)
         ├─ cached Journal root (placeholder)
         ├─ cached Finance root (Ledger destination)
         └─ cached Work root (placeholder)
```

- Rust 的 `admin_window.rs` 按需创建 `admin` webview，入口为 `index.html?app=admin`；窗口无系统装饰（`decorations(false)`）。关闭请求会被拦截并 `hide()`，再次打开取得同一窗口后 `show()+focus()`。开发构建每次打开会走 reload；正式构建只在隐藏满三分钟后 reload。这是运行时窗口恢复策略，不是另一个应用生命周期。
- `window_shell.rs` 为窗口显示、聚焦、工作区适配与透明 chrome 修复提供通用恢复层；`lib.rs` 注册 `open_admin_window`、Finance sidecar command，并设置 main/admin 使用相同运行时图标的路径。
- `src/apps/admin/main.ts` 在初始化设置、注册 destination、mount Host、绑定跨窗口数据重载与 wake repair 后，以未等待的 `ensure_ledger_sidecar` 启动 Finance Service。故 Host 的首次可见不依赖当前 destination 是否为 Finance。

### 2.2 Host 与 destination 缓存

- `integrations/admin/registry.ts` 维护进程内 destination 注册表；默认注册 Health、Journal、Finance、Work。`types.ts` 的实际 ID 是受限联合类型 `health | journal | finance | work`，每个定义都有 `mount()` 并返回含 `activate`、`deactivate`、`dispose` 的 handle；`canDispose` 与状态恢复为可选能力。
- `integrations/admin/shell.ts` 是 Host：它一次构建标题栏、侧栏和 `#adminContent` viewport；每个首次激活的 destination 会得到独立 `.insight-dest-root`，随后 root 与 handle 被放入模块级 `cache`。切换顺序是当前 destination 保存恢复状态 → `deactivate()` → 隐藏 root → 首次目标 mount/restore → 显示 root → `activate()`。
- 非活动 root 使用 CSS `display: none` 与 `aria-hidden`，而不是清空 `innerHTML`。普通领域切换与侧栏折叠不调用领域 `dispose()`；`disposeAll()` 只在 dataDir 变更路径使用，逐个 dispose、移除 root、清空 cache 并递增 Host generation。
- `destination-persist.ts` 将最后 destination 及领域返回的可恢复状态写到以 `dataDir` 为组成部分的 localStorage key；默认 destination 为 Finance。该状态属于 Host 选择/恢复，不是领域数据模型。

### 2.3 领域实现边界

- Health、Journal、Work 目前都注册为 domain destination，但实际 mount 的是通用“开发中”占位根（`tabs/health.ts`、`tabs/journal.ts`、`tabs/work.ts`、`placeholder.ts`）。
- Finance 注册为 `finance` destination，并委托 `ledger/destination.ts`。其首次 `activate()` 才连接 Finance Service；连接、未就绪、错误、Dashboard/Detail/Stats/Structure 内部 view、账本脏状态和 dispose 都留在 Finance destination 内。Host 不读取或修改账本 Store。
- Finance handle 在 dataDir 变更时以 `canDispose()` 检查未保存账本更改；获准后 abort 请求、失效加载、dispose 内部 shell 并清空领域 root。连接过程同时用 AbortController、连接代数、Host generation 和 mount 时 dataDir key 排除旧异步回写。

### 2.4 设置、dataDir 与弹层

- 设置按钮在 Host 标题栏挂载（`settings/index.ts`），不是任一领域页面入口。保存前先调用 `requestInsightDataDirChange()`；成功持久化新设置并重启 sidecar 后，才 `notifyDataDirChanged()`。
- Host 通过 `bindDataDirChanged()` 接收本窗口 custom event、跨窗口 storage/event 通知；先运行所有 cached handle 的 `canDispose`，之后 dispose 缓存并按原 active destination 重建。
- 设置 dialog 通过全局 modal root 挂载；Finance 自己的 confirm 与 modal 也在其全局机制内处理。由此 titlebar/Host 不需要通过领域 sibling DOM 管理浮层。

## 3. 仍是计划、预留或未采用的部分

以下是设计谱系中存在、但不能表述为当前实际架构的内容；这里不以任何验收状态推断取舍。

| 设计或预留 | 当前代码事实 |
| --- | --- |
| 可扩展的任意 `InsightDestination`（计划示例为 `id: string`）及 future workspace section | 实际 ID 仍是四项受限联合类型；`kind: "workspace"` 虽在类型中出现，但默认注册全是 domain，侧栏没有 future section 或动态工作空间条目。 |
| Conversation、Context、Relation、跨领域首页/Overview、最近或保存的视图 | 未注册 destination、未见共享数据模型、持久化 schema 或空入口；这与 Host 不承担 Archive 通用对象的边界一致。 |
| Health、Journal、Work 的领域业务 | 当前为占位 destination；Host 仅提供其根与生命周期。 |
| `archiveRoot`、Archive 统一物理根及跨领域数据统一 | 未作为实际设置字段或 Host 存储模型；当前仍使用 `dataDir`。 |
| Host 的独立显式销毁入口 | 当前可见代码中 Host 的实际全量 dispose 由 dataDir change 使用；窗口关闭的既定语义是 hide/reuse，未导出一个普通关闭即销毁的 Host API。 |
| 动态工作空间条目的持久化、缓存淘汰、跨窗口领域同步 | 未见实现；当前只持久化最后 destination/其可恢复状态，缓存为本 admin webview 的模块级 Map。 |

此外，旧 `AdminTab*` 注册 API 仍作为 `registry.ts` 和 `types.ts` 的 deprecated 兼容层存在；实际默认接线走 `InsightDestination` registry，而不是旧的“激活即 unmount”模型。

## 4. 与 0.0.17 计划谱系的交叉关系

| 文档 | 对 Insight 的角色 | 与实际架构的关系 |
| --- | --- | --- |
| `plans/v0.0.17-snapshot.md` | 版本收束计划：双窗口、admin frame、隐藏复用、sidecar 非阻塞启动及 dataDir 重载。 | 对应 Rust window 壳、`admin/main.ts` 非阻塞 ensure、标题栏设置与 Host 的 dataDir dispose/recreate 路径。它不定义 Finance 内部 UI。 |
| `plans/v0.0.17-insight-spec.md` | Host 的上层契约：自绘 chrome、核心领域、缓存 root、Host/领域职责、全局 modal 与 dataDir guard。 | `admin_window.rs`、`shell.ts`、`registry.ts`、`destination-persist.ts`、`host-guards.ts`、四个 tabs 与 `ledger/destination.ts` 均为其实际落点。 |
| `plans/v0.0.17-spec.md` | Finance 数据、Service、Candidate Commit 与 Host 集成的领域规格。 | Host 只把 Finance 作为 destination；`ledger/destination.ts` 继续自行处理 Service 连接、错误与账本生命周期，未将数据或 Commit 迁进 Host。 |
| `plans/v0.0.17-finance-ui-execution.md` | Finance 内部 CardDetailSurface 的唯一 UI 执行计划。 | 它位于 Finance destination 内；Host 缓存 Finance 根但不拥有其内部 Dashboard/Detail 等 keep-alive 或 Store。 |
| `CURRENT.md` / `SYSTEM.md` / `decisions/surfaces.md` / `decisions/data.md` | 当前事实与不可回退护栏。 | 为两个 webview、hide/reuse、frameless titlebar、单一 Insight dataDir 入口、无自动迁移与领域数据独立性提供稳定边界。 |

## 5. 来源证据

### 文档与决策

- `docs/README.md`：文档职责、0.0.17-snapshot 定位、当前 Insight/Finance/dataDir 摘要。
- `docs/GLOSSARY.md`：Orbita Insight、四个领域区、`dataDir` 与 `archiveRoot` 的现行术语边界。
- `docs/CURRENT.md`：单一 Tauri 进程、main/admin 双窗口、四领域现状、hide/reuse 与 sidecar 启动现状。
- `docs/SYSTEM.md`：两个界面的系统职责与当前 dataDir/Finance Service 边界。
- `docs/DECISIONS.md`、`docs/decisions/surfaces.md`、`docs/decisions/data.md`、`docs/decisions/runtime.md`、`docs/decisions/interaction.md`：窗口、modal、dataDir、wake repair 与高成本布局的护栏。
- `docs/adr/README.md`、`docs/adr/0003-perceived-responsiveness-and-durable-completion.md`：ADR 使用方式及侧栏/异步反馈的已确认原则。
- `docs/plans/v0.0.17-snapshot.md`、`docs/plans/v0.0.17-insight-spec.md`：0.0.17 收束与 Insight Host 的设计来源。

### 实际代码

- `orbita/src-tauri/src/admin_window.rs`、`window_shell.rs`、`lib.rs`、`commands/admin.rs`、`commands/integration.rs`：admin 窗口创建/隐藏/恢复、frame、图标、command 与 Finance Service 生命周期入口。
- `orbita/src/apps/admin/main.ts`：Insight 启动顺序与非阻塞 `ensure_ledger_sidecar`。
- `orbita/src/integrations/admin/{index.ts,shell.ts,registry.ts,types.ts,destination-persist.ts,host-guards.ts,window.ts,placeholder.ts}`：Host、registry、缓存、恢复、guard 与 Panel→Insight 打开路径。
- `orbita/src/integrations/admin/tabs/{health.ts,journal.ts,finance.ts,work.ts}`：四个实际 destination 的接线。
- `orbita/src/integrations/admin/settings/index.ts`、`orbita/src/core/data/dir-sync.ts`：唯一设置入口与跨窗口 dataDir 通知。
- `orbita/src/integrations/ledger/destination.ts`：Finance 作为 Host consumer 的独立连接、状态、脏数据 guard、异步失效与 dispose。

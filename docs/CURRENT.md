# 当前状态

> **版本**：`0.0.17-snapshot`  
> **代码基线**：`d6bac5a`（0.0.17-snapshot + 0.0.18 仓库结构）  
> **最后核对**：2026-08-30；0.0.17 收束见 [`plans/v0.0.17-closeout.md`](plans/v0.0.17-closeout.md)。Finance 时间排序见 [`ADR 0002`](adr/0002-finance-chronological-order-without-drag.md)，AccountSelect 见 [`ADR 0004`](adr/0004-finance-account-select-cascade-menu.md)，领域契约见 [`specs/orbita-finance.md`](specs/orbita-finance.md)。

本文件只记录当前工作树的真实状态、风险与下一步。不可回退的理由见 [`DECISIONS.md`](DECISIONS.md)；详细 Finance 设计见 `specs/orbita-finance.md`；历史过程见 `HISTORY.md`。

## 当前焦点

- [x] **Finance 工作台**（收束计划 §4.2）：生产路径 `views/detail/index.ts` 已接线 shell、右栏三模块、搜索、Composer modal、CardDetailSurface、保存状态机与 BalanceAudit；Vitest 与 Python 回归覆盖核心链路。
- [x] **AccountSelect**（ADR 0004）：Composer、行内编辑、校验面板已用 `mountAccountSelect`；用户 2026-08-30 验收完成。
- [x] **Finance 时间排序**（ADR 0002）：拖拽已移除；`domain/seq.ts` 比较器、CSV `time` metadata 与 Python e2e 已落。
- [x] **Finance 壳层与可信保存**（ADR 0003）：绿勾 = Commit 确认；后台 reload 受 `workGeneration` 守卫。
- [x] **Insight / snapshot 运行时**（§4.1）：用户 2026-08-30 确认日常无问题。
- [x] **多应用仓库结构**（[`v0.0.18-repository-structure`](plans/archive/v0.0.18-repository-structure.md)）：`orbita/` 已迁入 `apps/desktop/`；`apps/desktop/dev.bat` 2026-08-30 启动验证通过。
- [ ] **CSV 导入实机**（§4.3）：代码与自动化已落；用户未验收 Tauri 导入→保存→重载。
- [x] **旧 Detail 链路删除**（§4.2）：阶段 D 文件已删（`views/detail/*` 除 index、`views/form/*`、`account-picker` 等）；`ledger.css` 遗留块待清。
- [-] **预设 409 前端**：后端 revision + 409 已落；`finance-rail-filter` 保存预设时未 catch 冲突并提示用户。

## 已实现基线

### Orbita Panel 与 Orbita Insight

- Orbita 是单一 Tauri 进程；Orbita Panel（代码窗口 label `main`）与 Orbita Insight（`admin`）是两个 webview 窗口。
- Insight 当前有 Health、Journal、Finance、Work 四个领域区；tab id 为 `health | journal | finance | work`。Health、Journal、Work 目前以壳为主，Finance 承载主要业务。
- Insight 关闭时隐藏、再次打开复用 webview；使用 admin 专属 frame。开发模式下每次打开 Insight 会 reload；正式版仅在隐藏超过 3 分钟后 reopen 时 reload。

### Orbita Finance

- Finance 已进入 Insight；底层仍使用 bean/Beancount、Python sidecar 与 TypeScript 模块。
- 当前 Insight 入口异步确保 Finance Service 启动；Panel 与 Agent 启动不拉起 Python。
- Finance 根固定为 `{dataDir}/bill`。dataDir 切换会重载两个窗口并重启 Finance Service；切换不迁移旧数据。
- Finance 默认是 Dashboard Hub，可钻取统计、明细/整理和导入；指标、最近交易仍占位。
- 明细页 `CardDetailSurface` 经 `views/detail/index.ts` 接入：Store command、软删/撤销、Composer modal、CSV staging、保存状态机与 BalanceAudit 均已实现。同日排序由 time metadata + 数值 `seq` 确定性比较器承担（ADR 0002）。

### Finance 壳层与工作台

- 明细顶栏横跨主列与右栏，吸顶；返回、居中标题/搜索、保存与右栏开关在顶栏；筛选、导入与添加在右栏。
- 右栏固定 360px：筛选（`finance-rail-filter`）、添加（`finance-rail-add`）、校验（`finance-rail-audit`）。
- 左 Admin 栏与右栏：逻辑列一次切换 + FLIP 重居中（ADR 0003）。
- 筛选乐观派生：`ledger-card-store` / `snapshot-store` 拆分 filter input 与 rendered list；rAF latest-wins。
- 列表：≤1000 全量、>1000 虚拟化；date pin 纯 CSS sticky。

### 数据与开发

- 当前 `dataDir` 同时承载 App State 与 Orbita Archive 早期数据；`archiveRoot` 尚未实现。
- `dev.bat` 以命名互斥锁拒绝第二会话；Job Object 托管子树；异常退出最多三次后停止。见 [`DEV.md`](DEV.md)。
- 仓库已重组为多应用拓扑：桌面应用位于 `apps/desktop/`；Android、sync 与 contracts 仅建立目录边界，尚未开始实现。
- Vitest 最多两 fork；`npm test` 经 `test-session.ps1` Job Object 与跨进程单运行锁。
- Ledger Python 测试强制隔离临时 bill 根。

## 已知风险

- **P0（行为）**：Panel bookmark/folder/app dialog 仍挂 `#app` 未走 `#orbita-modal-root`；finance-rail-filter 预设 409 无前端提示；Reload 策略叠加（admin_window 180s + wake-repair + dev open reload）；frame-page-load emit 无 TS listener。
- **明确保留（勿误删）**：`page-shell` + `finance-layout`（dashboard/stats/structure）、`views/import/csv.ts`、`views/categories/*`、`views/wallets/*`；filter/rendered 拆分、FLIP、绿勾后台 reload、无拖拽等为 ADR/CURRENT 定案，非债务。
- **dev 无响应 / 异常退出**：见 [`DEV.md`](DEV.md)「窗口无响应」「dev 异常退出」；恢复用 `dev-clean` 后重开 `dev.bat`。
- **窗口工作区适配**：`failed to receive message from webview` 时保留 1280×800 并继续运行。
- **CSV 导入**：解析、staging 与 Commit 链路有 Vitest/Python 覆盖；用户 2026-08-30 未做 Tauri 实机导入验收。

## 未排期维护项

完整清单见收束计划 [§4.4](plans/v0.0.17-closeout.md#44-未排期维护项非阻塞)。

## 下一步

1. （可选）`ledger.css` 遗留样式清理（§4.4 P1）。
2. （可选）使用前补测 CSV 导入→保存→重载（Tauri 实机）。
3. 0.0.18：从 [`v0.0.18-health-page-initial-design.md`](plans/v0.0.18-health-page-initial-design.md) 立项。

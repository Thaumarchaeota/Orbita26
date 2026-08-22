# 当前状态

> **版本**：`0.0.17-snapshot`  
> **代码基线**：`751203f`（0.0.17 snapshot）  
> **最后核对**：2026-08-22；Finance 时间排序与撤销拖拽见 [`plans/v0.0.17-finance-chronological-order.md`](plans/v0.0.17-finance-chronological-order.md) 与 [`adr/0002-finance-chronological-order-without-drag.md`](adr/0002-finance-chronological-order-without-drag.md)。收束计划见 [`plans/v0.0.17-snapshot.md`](plans/v0.0.17-snapshot.md)；Finance UI 重构唯一执行计划见 [`plans/v0.0.17-finance-ui-execution.md`](plans/v0.0.17-finance-ui-execution.md)，产品逻辑真源见 [`plans/v0.0.17.md`](plans/v0.0.17.md) §25。

本文件只记录当前工作树的真实状态、风险与下一步。不可回退的理由见 [`DECISIONS.md`](DECISIONS.md)；详细 Finance 设计见 `specs/orbita-finance.md`；历史过程见 `HISTORY.md`。

## 当前焦点

- Finance 工作台重构：已完成产品决策与执行计划，尚未开始实现；唯一执行输入为 `docs/plans/v0.0.17-finance-workspace-redesign.md`。现有顶栏筛选/右栏 Composer 仍是旧实现事实，不能误报为新方案完成。

- **Finance 工作台重构设计中**：已落地的“桌面筛选常驻顶栏、右栏 Composer”不再是后续方向。新方向为右栏依次承载筛选、添加、校验，Composer 改受管理 modal；校验与账户筛选语义仍在收敛，未经用户确认不得实施。决策日志见 [`v0.0.17-finance-shell-responsiveness.md`](plans/v0.0.17-finance-shell-responsiveness.md#15-live-decision-log--finance-workspace-redesign)。

- **Insight Host 重构**（[`plans/v0.0.17-insight-spec.md`](plans/v0.0.17-insight-spec.md)）：已收官（§7 全部验收；Vitest 14 项）。
- **Finance 时间排序与撤销拖拽**（[`plans/v0.0.17-finance-chronological-order.md`](plans/v0.0.17-finance-chronological-order.md)、[`adr/0002-finance-chronological-order-without-drag.md`](adr/0002-finance-chronological-order-without-drag.md)）：**2026-08-22 实现与自动化已验证**——移除拖拽（`cds-drag`/`reorder-same-day`/旧 Detail drag）；统一比较器（UI `sortDetailEntries`、Commit `ledger_sort_key`/`sortForCommit`）；P0 metadata 透明输出、字符串 codec、Candidate 版本指纹与按目标互斥 commit。`txn-time.ts` 有效时间提取与显示/排序共用；时间输入 CSS 已隐藏 WebKit 时钟图标。`npm.cmd test`（Vitest 197 + Chromium 脚本）与 Python 98 项已通过；真实 Tauri/CSV 跨进程流程仍待验。原 [`plans/v0.0.17-finance-time-drag-repair.md`](plans/v0.0.17-finance-time-drag-repair.md) 拖拽部分已作废。
- **Finance 壳层流畅化与可信保存反馈**（[`plans/v0.0.17-finance-shell-responsiveness.md`](plans/v0.0.17-finance-shell-responsiveness.md)、[`adr/0003`](adr/0003-perceived-responsiveness-and-durable-completion.md)）：**2026-08-22 代码与 Vitest 已落地**——顶栏提升为 stage 兄弟、桌面筛选常驻（CSS 默认隐藏筛选 toggle）、左右栏瞬时布局切换 + FLIP、Commit 后立即绿勾且 reload/余额审计后台化。`npx vitest run` 206 项通过；真实 Tauri 五类验收仍待用户完成，计划保持 `[-]`。
- **并行收束**（[`plans/v0.0.17-snapshot.md`](plans/v0.0.17-snapshot.md)）：Insight 多次开关、Finance Service、`dataDir` 切换和开发启动保护的手工验收仍待完成。

## 已实现基线

### Orbita Panel 与 Orbita Insight

- Orbita 是单一 Tauri 进程；Orbita Panel（代码窗口 label `main`）与 Orbita Insight（`admin`）是两个 webview 窗口。
- Insight 当前有 Health、Journal、Finance、Work 四个领域区；tab id 已改为 `health | journal | finance | work`。Health、Journal、Work 目前以壳为主，Finance 承载主要业务。
- Insight 关闭时隐藏、再次打开复用 webview；使用 admin 专属 frame。当前代码已处理标题栏 overlay、窗口控制区和双窗口运行时图标。

### Orbita Finance

- Finance 已进入 Insight；当前底层仍使用 bean/Beancount、Python sidecar 与 TypeScript 模块。产品名是 Orbita Finance，技术目录/command 中的 `ledger`、`bkeasy` 仍是遗留实现名。
- 当前 Insight 入口异步确保 Finance Service 启动，不能阻塞窗口显示；Panel 与 Agent 启动不拉起 Python。
- Finance 根当前固定为 `{dataDir}/bill`。dataDir 切换会重载两个窗口的数据并重启 Finance Service；切换不迁移旧数据。
- Finance 默认是 Dashboard Hub，可钻取统计、明细/整理和导入；指标、最近交易和若干后续入口仍未完成。
- Finance 仍是 Dashboard / 统计 / 明细 / 导入的内部 keep-alive 结构。明细页 Phase C `CardDetailSurface` 已接入：Store command 边界、软删/撤销、Composer、CSV staging、保存状态机与 BalanceAudit 均有实现。**同日拖拽已撤销**（[`ADR 0002`](adr/0002-finance-chronological-order-without-drag.md)），改由 time metadata + 数值 `seq` 确定性排序；拖拽 UI/命令已删除。
- 文档/术语重构验收已完成；snapshot 未收官前不把 `0.0.17-snapshot` 称为正式版本。

### Finance 壳层（2026-08-22）

- 明细顶栏横跨主列与右栏 rail，吸顶、无独立白卡；桌面端日期/类型筛选常驻顶栏中段，窄屏（`<1080px`）才显示「筛选」按钮与折叠面板。
- 左 Admin 栏与右记一笔栏：逻辑宽度/Grid 列一次切换，明细主体 `finance-detail-flip-frame` 做 FLIP 重居中；不再 transition sidebar width 或 rail grid/gap。
- 保存：Commit 成功后立即绿勾与 clean baseline；`loadDetail(fromCommit)` 与 `reloadBalanceAudit()` 后台执行，带 `workGeneration` 守卫；刷新失败显示「已保存，刷新失败 · 重试」且不撤销绿勾。
- 交易卡片 identity：**仅显示时间**（`HH:mm`），日期由分组 sticky pin 承担；点击时间打开 popover 同屏编辑日期与时间（`cds-datetime-popover`），避免行内日期列撑宽跳变。

### 数据与开发

- 当前 `dataDir` 同时承载 App State 与 Orbita Archive 的早期数据；`archiveRoot` 只是未来架构方向，尚未实现。
- `dev-clean`、`dev.bat` 崩溃重启、Vite 恢复后的 webview reload 已落代码；`dev-clean` 已扩展清理 ledger 孤儿 uvicorn（见 [`DEV.md`](DEV.md)「dev 异常退出」）。
- Ledger Python 测试现强制使用隔离临时 bill 根；若测试入口继承 `D:\data_orbita` 或其 bill 根，会在任何写入前拒绝。`smoke_test.py` 是独立诊断脚本，不作为常规测试入口。

## 已知风险与待验

- snapshot 计划（[`plans/v0.0.17-snapshot.md`](plans/v0.0.17-snapshot.md)）中 Tauri 实机项（多次开关、任务栏图标、sidecar 端口复用等）仍待人工验收。
- Dashboard 真实指标、最近交易等后续产品入口仍属待定义范围（见 Finance spec §1.2）。
- **dev 无响应**：2026-08-09 实机出现 `orbita.exe` `Responding=False`（与此前 `0xffffffff` 退出不同）。当次与 `scripts/capture-finance-phase-a.ps1` 自动循环（循环内重复 `Add-Type`、连续缩放 + 全局热键）叠加 cargo/HMR 时段相关；脚本已改为默认手工流程。恢复：`dev-clean` + 结束未响应进程后重开 `dev.bat`。见 [`DEV.md`](DEV.md)「窗口无响应」。
- **dev 异常退出**：`orbita.exe` 曾以 `0xffffffff` 退出并留下 1420 / 8000–8010 孤儿进程；`dev-clean` 已增强处理，`dev.bat` 现以命名互斥锁拒绝第二个会话，避免并发启动互相清理/抢占 1420。排错步骤与日志位置见 [`DEV.md`](DEV.md)「dev 异常退出」；`orbita.exe` 首次异常退出的根因（是否与 Finance HMR 相关）仍待观察。
- dev 模式连接失败时仍会显示 WebView 默认错误页；当前恢复策略是 Vite 恢复后自动 reload。
- **Finance Phase C：视觉状态（2026-08-10）**。四条路径已修复；Chromium harness 记录 `prefers-reduced-motion=false` 与 `transitionrun`/`transitionend:background-color`（见 phase-c 证据目录）。若 Tauri 仍瞬变，先查 `matchMedia('(prefers-reduced-motion: reduce)')`；为 true 时 CSS 刻意 `transition: none !important`。Tauri 复验：`localStorage.orbitaCdsMotionDiag=1` 后 reload，运行 `scripts/capture-finance-phase-c-motion.ps1`（可选 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`）。
- **Finance Phase C：Tauri 全流程仍待验**。编辑/Composer/CSV/保存/BalanceAudit 完整交互矩阵未完成前，阶段 C 不得标收官。
- **Finance Phase C：本轮功能阻塞（2026-08-10）**。六项修复已落代码：① `requirements.txt` 补 `beancount>=3.0`，`/health` 报告 `beancount_ok`；② 导入：`modal-root` 断连重建、`CdsCsvModal.open` 异步完成、Detail 暴露 `openImport`；Vitest `cds-import.regression.test.ts`；③ BalanceAudit：`/api/stats` 503 + `formatLedgerNetworkError`，不再原样显示 `Failed to fetch`；④ 未落盘 `_is_new` 删除直接移出工作副本；⑤ 类型筛选 portal 后 `syncTypeFilterUi` 修复；⑥ Composer 移除「已加入待保存」。**Tauri 实机全流程仍待验**，阶段 C 保持 `[-]`。
- **Finance Phase C：Beancount 校验边界（2026-08-10）**。前端只做字段格式与基础结构校验，已移除整笔配平；`@`/`@@`/`{}` cost、空 posting 与 transaction-level 字符串 metadata（含 `time`）贯穿全链路；Candidate 诊断单条可关联多个 `item_ids`。reload 失败进入 `refresh_failed`，不伪造保存成功。
- **Finance Phase C：自动化证据分层（2026-08-10）**。**单元/mock**：Vitest 156 项、Python 单元（含 mock atomic_write 的 token 测试）。**真实隔离落盘**：`test_metadata_time_e2e_atomic_commit_reload`、`test_cost_annotations_e2e_commit_reload`。**真实 Tauri**：全流程仍待验，阶段 C 保持 `[-]`。
- **Finance 列表稳定性（2026-08-10）**。日常账本优先：筛选后 ≤1000 全量连续渲染，>1000 虚拟化，已虚拟时 <800 才退回全量。`list-render-mode.ts` + `cds-virtual-list.ts` 已落代码；全量无 spacer/窗口挂卸/按组 IO，date pin 纯 CSS sticky + 绝对定位 `::after` 渐变遮罩（不占布局，约 14px），无 pin IO。`--ledger-bg` 与 `.admin-content` 共用 `--admin-bg`（`#f4f5f7`）。Vitest **177** 项 + `cds-scroll-chromium` 通过。Tauri 500/1000/1001 与跨阈值筛选仍待验；Phase C 保持 `[-]`。
- **Finance CSV 时间（2026-08-22）**。CSV 模板为 10 列 `date,time,type,amount,currency,from_account,to_account,payee,remark,tags`；`time` 可空，非空 `HH:mm` 写为 transaction `time: "YYYY-MM-DDTHH:mm:00+08:00"` metadata；有效 `time` 参与同日排序。解析、staging 与自动化回归已验证；真实 Tauri 导入—保存—重载流程仍待验。
- 新 docs 的迁移与逐版本覆盖审计已完成；旧资料仍可用于历史核对，但不应成为当前实现的唯一说明。

## 下一步

1. 补验 [`v0.0.17-finance-shell-responsiveness.md`](plans/v0.0.17-finance-shell-responsiveness.md) 的真实 Tauri 五项验收（侧栏 FLIP、顶栏筛选、绿勾与后台刷新）。
2. 补验 [`v0.0.17-finance-chronological-order.md`](plans/v0.0.17-finance-chronological-order.md) 的真实 Tauri 与 CSV 跨进程流程（排序、无拖拽、CSV/保存/reload）。
3. 补 Chromium 滚动回归和完整 C 的 Tauri 交互证据；未完成前不得进入阶段 D 的“最终回归”口径。
4. 阶段 C 验收后再删除旧 Detail 链路，并完成 1440/1280/1024 × sidebar × rail/drawer 实机矩阵。
5. 继续 snapshot 手工验收（Insight / sidecar / dataDir）。
6. dev 异常退出时按 [`DEV.md`](DEV.md)「dev 异常退出」执行 `dev-clean` 后再 `dev.bat`。

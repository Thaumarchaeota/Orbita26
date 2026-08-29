# 开发、调试与验证

本文只保留仍会影响当前开发的操作和故障结论。历史来龙去脉见
[HISTORY.md](HISTORY.md)；原始证据见 `docs_legacy/HANDOFF.md`（不进 Git）。

## 启动与最低验证

| 入口 | 适用场景 | 不覆盖的能力 |
| --- | --- | --- |
| `orbita/dev-web.bat` | UI、CSS、普通前端交互的快速预览；浏览器为 `http://127.0.0.1:1420` | Tauri command、窗口、v2ray、佳明、Orbita Insight 和 Finance Service |
| `orbita/dev.bat` | 完整桌面 App；涉及 Rust、双窗口、佳明、click-through、数据目录或 ledger 时必须用它验收 | 首次 Rust 编译会较慢 |

每次完成代码修改后，结束对话前必须运行 `orbita/dev.bat`，等待启动过程完成并确认无报错。
`dev-web.bat` 仅用于中途快速预览，不能替代这项验证。未经用户明确要求，不运行
`cargo check`、`npm run build`、`tauri build` 或其他 build 命令。

## Vitest / Tinypool 占用异常

Vitest 默认会按可用 CPU 创建多个 fork；本机曾一次创建 13 个 Tinypool worker，若测试根进程
被中断或重复启动，残留 worker 会持续占用 CPU。项目配置现限制为最多两个隔离 fork，且同一
工作区同时只能有一个 `vitest run`：后来的命令在配置加载时失败，不得再派生另一组 worker。
`npm test` 必须通过 `scripts/test-session.ps1` 启动，该脚本用 Windows Job Object 托管
`npm run test:run` 的完整子树，异常退出时回收 worker。不要把 `npm test` 改回直接执行 Vitest，
不要移除运行锁，也不要提高默认 fork 数来换取短暂速度。

排查时先确认没有残留，再启动下一轮测试：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'vitest|tinypool' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

直接 `npx vitest run <file>` 虽不经过 Job Object，但仍受两 worker 与单运行锁约束；用于短小的
定向回归后必须等进程退出。Popover/picker 测试要显式 `dispose()` handle，不能只
`replaceChildren()`，否则 Happy DOM 的 observer 和定时器会跨测试保留。

`dev.bat` 是单会话入口：它以 Windows named mutex 覆盖清理、Vite/Tauri 启动及异常重试。
第二次启动会立即退出，且**不会**调用 `dev-clean`、结束端口或干扰已有会话；请回到第一个终端
停止会话后再重试。这样避免两个开发终端在 1420 的端口检查与 Vite bind 之间互相清理、抢占和重启。
该会话会追踪自身启动的 `npm tauri dev` 根 PID；异常重试或退出时只以该 PID 清理其进程树，
不会清理其他终端的 Cargo、Node 或 Vite。若开发终端被系统强杀而来不及执行 finally，仍按本节的
`dev-clean` 恢复流程处理残留。

首次配置：

```powershell
cd <repo-root>
.\scripts\install-dev.ps1
.\scripts\install-buildtools.ps1  # Tauri 所需，管理员运行

cd orbita\python
.\setup.ps1                        # Garmin 与 ledger 的 venv / 依赖
```

安装后重开终端；若 `node` 或 `cargo` 找不到，先执行：

```powershell
. .\scripts\env.ps1
```

## `ERR_CONNECTION_REFUSED` / 1420

`dev.bat` 同时管理 Vite 和 `orbita.exe`。终端或 Cursor 被重启时，Vite 可能停止而旧
WebView 窗口仍存活；或者旧 Vite 占用 1420，导致 `beforeDevCommand` 失败。二者都会使
窗口显示 `ERR_CONNECTION_REFUSED`。这不是 Rust warning 导致的故障。

恢复方法：

```powershell
cd <repo-root>
powershell -ExecutionPolicy Bypass -File .\scripts\dev-clean.ps1
orbita\dev.bat
```

等待终端出现 Vite `ready` 与 `Running ... orbita.exe`。不要关掉运行 `dev.bat` 的终端。
`dev-clean.ps1` 会清理 1420/1421 与 8000–8010 端口占用、结束 `orbita.exe`，以及命令行含 `uvicorn`+`ledger` 的孤儿 Python。若仍报告端口占用，按其 PID 处理后再启动。详见下文「dev 异常退出」与旧 HANDOFF §25.0.42。

**PowerShell 陷阱**：脚本内勿用 `$pid` 作局部变量名——`$PID` 是只读自动变量（当前进程
ID），赋值会触发 `VariableNotWritable`，导致清理失败、端口仍占用。应使用 `$busyPid` 等
别名（见 `scripts/dev-clean.ps1`）。

`dev.bat` 调用清理脚本必须使用 `powershell -NoProfile`。本机 profile 可能注入 Conda/Mamba
初始化；若该初始化因权限或配置失败，会在项目启动前让清理过程退出，造成无关的 dev 重启循环。

注意：`dev-web.bat` 与 `dev.bat` 不能同时占用 1420。浏览器预览中 AI 与滴答被故意灰掉，
不是功能回归。

## dev 异常退出（`exit code 0xffffffff`）

`dev.bat` 在 `orbita.exe` 非零退出时最多重试三次（等待 5 秒、10 秒；第三次失败即停止并保留首个排查入口）。每轮 `npm run tauri dev` 由专属 Windows Job Object 托管；即使 npm 根进程先退出，也会回收该轮 Cargo/Vite/Node 子树。若主进程被 WebView/系统强杀（终端常见
`exit code: 0xffffffff`，**无 Rust panic 栈**），仍可能留下服务端口占用，最终表现为
`dev-clean` 报 `Port 1420 still in use` 或 Finance 连不上。

### 典型链路

1. `orbita.exe` 异常退出（开发中曾见于 Finance 模块频繁 HMR 之后；根因未完全定位）。
2. `dev.bat` 在有限重试期间启动下一轮前会回收上一轮 Job；若端口仍被外部残留占用，清理失败会停止启动并报告 PID。
3. 主进程退出时若未走到 `stop_sidecar`，**ledger uvicorn 子进程残留** → 多次重启后 **8000–8010 被占满**（`%TEMP%/orbita-ledger.log` 可见连续 spawn 记录，日志本身通常无 Python 异常）。

### 恢复（首选）

```powershell
cd <repo-root>
powershell -ExecutionPolicy Bypass -File .\scripts\dev-clean.ps1
orbita\dev.bat
```

`dev-clean.ps1` 通过 `netstat` 识别监听端口，而不依赖可能被权限策略拒绝的
`Get-NetTCPConnection` CIM provider；若端口仍被占用，脚本必须报告对应 PID 并以非零状态退出，
不得打印误导性的 `Clean`。

`dev-clean.ps1` 现行会：

| 目标 | 方式 |
| --- | --- |
| 1420 / 1421 / 8000–8010 | 按端口结束占用进程 |
| 孤儿 `orbita.exe` | `Stop-Process -Name orbita` |
| 孤儿 ledger sidecar | 结束命令行含 `uvicorn` 且含 `ledger` 的 `python.exe` |

脚本以 1420、8000 的 `Listen` 为空作为成功条件；失败时输出占用 PID，需任务管理器手动结束后再跑。

### 窗口无响应（`Responding = False`）

除 `0xffffffff` 强杀外，开发中还观察到 **Orbita 主窗口/Insight 窗口卡住、任务管理器显示“未响应”**：

1. **自动化截图脚本**（`scripts/capture-finance-phase-a.ps1` 旧版）：在循环内重复 `Add-Type` 编译、连续 `SetWindowPos` 缩放，并注入全局 `Ctrl+Alt+F`，若同时发生 **cargo 重编译 / HMR / Finance 连接**，WebView2 可能长时间不响应。现行脚本默认只打印手工步骤；自动循环需显式 `-CaptureOnly`，且每次点击前检查 `Process.Responding`。
2. **Finance HMR**：`CURRENT.md` 已记录 `orbita.exe` 在 Finance 频繁热更新后异常退出的待观察项；无响应可能是同一类 WebView 压力的前兆。
3. **恢复**：任务管理器结束 `orbita.exe`（或 `dev-clean.ps1`），确认 1420/8000 释放后重新 `dev.bat`。**不要在窗口未响应时继续跑截图脚本或连续 dev 重启。**

### 排查日志

| 日志 | 路径 | 说明 |
| --- | --- | --- |
| dev 终端 | 运行 `dev.bat` 的窗口 | 看 `0xffffffff`、`beforeDevCommand terminated`、端口占用 PID |
| ledger sidecar | `%TEMP%/orbita-ledger.log` | sidecar 启动与 uvicorn 输出；**不能**用来判断 `orbita.exe` 崩溃原因 |

若清理后仍反复 `0xffffffff`，在复现时打开 DevTools（F12）看 Console 是否有 JS 异常，并避免在 Finance 大改时依赖长时间 HMR 循环。

## Finance Service（当前为 Python sidecar）

- venv 必须先由 `orbita/python/setup.ps1` 创建；运行时使用
  `orbita/python/.venv/Scripts/python.exe`（或明确设置 `ORBITA_PYTHON`），不能静默回退到
  系统 Python。
- Orbita Panel 与 Agent 不应在启动时拉起 Python。当前 Insight 入口会异步确保 Finance Service 启动，
  Finance 页面使用它；打开窗口不得等待健康检查而阻塞。若要改为仅切入 Finance 才启动，必须先另立
  计划并验证窗口、错误页与进程生命周期。
- 连接/启动失败要展示 Rust 返回的具体错误，开发时查看
  `%TEMP%/orbita-ledger.log`；不要吞掉 `start_sidecar` 错误，也不要把 stderr 丢到
  `Stdio::null()`。
- 前端不得在 `ledger_api_base` invoke 失败后盲猜 `http://127.0.0.1:8000`。必须由 Rust
  返回实际端口；端口可能是 8000–8010 中的任一个。
- 手工健康检查仅用于排查：`curl http://127.0.0.1:8000/health`。端口不是固定事实，优先
  看日志和 command 返回值。

### 旧 sidecar / “资产管理服务未就绪”

若磁盘中的账本合规但页面仍显示未就绪，先怀疑旧 uvicorn 被错误复用，而不是先责怪账本
格式。历史根因是旧实现见 8000 的 `/health` 成功就采用该进程，尽管它继承了旧的
`ORBITA_LEDGER_DATA_ROOT`；旧“重试”也只重新连接、不会重启它（旧 HANDOFF §25.0.40）。

现行约束：

- 仅当**本进程 child 仍活着、数据根一致且 health 正常**时才能复用 sidecar。
- 数据根不一致、只剩 port 没有 child，或切换 `dataDir` 后，都视为 stale，停止后重启。
- 资产页的“重试”在 Tauri 中必须调用 `restart_ledger_sidecar` 后才 reconnect。
- 8000 被历史进程占用时，新的 sidecar 应改用 8001–8010；全被占用时先跑 `scripts/dev-clean.ps1`（会结束 ledger 孤儿 uvicorn），仍失败再在任务管理器结束 `python -m uvicorn ledger.main` 后重开应用。

账本根固定为 `{dataDir}/bill`。当前唯一支持的基础布局是：

```text
bill/
  account.bean
  category.bean
  ledger/2026.bean
```

`account/` 目录加 `ledger.md` 不受支持；把 `bill` 自身选作 `dataDir` 会造成
`bill/bill`。空账本目录不会自动生成这三个文件，应走明确的新建/覆写操作。更完整的
数据路径与切换规则由 `SYSTEM.md` 维护。

### Ledger Python 测试数据隔离

Python 测试绝不能读取或写入用户的 `{dataDir}/bill`。测试入口必须创建并显式使用临时 bill 根；如果 `ORBITA_LEDGER_DATA_ROOT` 继承到 `D:\data_orbita` 或其 `bill` 根，必须在任何文件写入前失败。不得使用 `setdefault` 继承父进程的数据根。

会启动 API/uvicorn 的测试子进程也必须显式传入同一隔离根。`smoke_test.py` 是单独的诊断脚本，不是常规测试入口；运行它时仍须明确指定安全的非生产数据根。发生账本覆盖风险时，立即停止测试、不要尝试用 fixture 重建用户 bean，并从用户的备份恢复。

## Garmin：最高优先级安全约束

Garmin 的 token 是用户资产，SSO 是稀缺、会触发账号级限流的操作。**同步路径零 SSO**：
今日区、设置同步、Agent 同步和任何自动同步只能以已有 token 刷新和拉数据；没有 token
应明确返回 `no_token`，引导用户使用显式“重新登录”。不得为了“自动修复”在同步中登录。

显式重新登录的约束：

- 单路由、单次尝试；禁止多端口/多代理/多策略组合重试。
- 遇 429 后写本地 `garmin_rate_limit.json` 并停止尝试。删该文件只能解除 Orbita 的本地
  冷却，**不能**解除 Garmin 服务器封禁；用户应至少等待 24 小时，不能连点。
- 失败时绝不能删除 `garmin_tokens.json` 或要求用户先删 token；不要用 username 冒充
  `display_name` 绕过 profile 失败。
- 改 Garmin 必须控制实际登录次数，并以脚本和 `dev.bat` 验证后才能宣称修复。

这是由 2026-08-04 的 429 封禁事故得出的硬禁令；完整根因和已否决方案见
`HISTORY.md#garmin-sso-封禁事故` 与旧 HANDOFF §25.0.13–§25.0.14。

## UI / 交互的不可回退结论

### Dialog

所有 dialog/backdrop 必须走 `ui/modal-root.ts` 的 `mountModalBackdrop` / `openDialog`；确认框
只能通过全局单例 `getConfirmDialog()` 获得。禁止直接 append 到 `#app` 或 `body`，禁止在
不同业务模块各自 `mountConfirmDialog()`，关闭时必须使用 `hidden` 或 `display:none`，不能
只降 `opacity`。否则会重现设置层盖住删除确认、点击删除却改主题的 P0 事故（旧 HANDOFF
§25.0.29.1）。

透明主题下 modal 打开必须立即恢复窗口交互；隐藏的 dialog 内 tooltip 不能参与命中测试。

### 书签 / 应用网格与文件夹

当前可交付方案是 `tile-grid.ts` 的 **DOM + FLIP**：拖拽中以 `insertBefore` 做实时预览，
松手后一次 `setItems`；排序越过目标约 58% 中线才换位。归入/合并只在根网格目标的中心区
触发，拖出文件夹越过 panel 边界即提交并关闭。ghost 必须挂在 `document.body`，源 tile 用
`visibility:hidden` 占位；不能把 `position:fixed` ghost 放在带 transform 的 folder panel 内。

**禁止恢复**虚拟 transform/slot 数学路线：`measureGrid`、`slotIndexFromPoint`、
`applyVirtualShift`、dropzone/dwell 状态机等已被整文件删除，因为它造成落点不一致、卡顿和
浮层错位。书签/应用保持网格；文件夹是锚定毛玻璃浮层、4 宫格预览和双击内联改名，不改为
居中 dialog 或列表。详见旧 HANDOFF §17.5（废弃原因）与 §17.11（现行方案）。

## Orbita Insight 窗口

Orbita Insight 是同一 Orbita 的第二个窗口。新窗口必须同样使用 `decorations(false)` 和自绘顶栏；若
预创建页面早于 frame 插件加载，需要在 attach/open 时触发 `frame-page-load` 并作一次延迟
重试。顶栏 drag 区不可挡住最小化/最大化/关闭按钮：容器 `pointer-events:none`，按钮恢复
`pointer-events:auto`。详见旧 HANDOFF §25.0.35–§25.0.36。

## 打包

只有明确要求构建或发布时才运行：

```powershell
. .\scripts\env.ps1
cd orbita
npm run tauri build
```

产物为 `orbita/src-tauri/target/release/orbita.exe`。发布前还需按 manifest 实际情况同步版本，
不要只改文档版本号。

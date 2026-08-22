# 关键历史与已否决方案

这里记录仍能影响未来判断的事故、迁移和取舍，而不是逐日工作日志。当前真实状态看
[CURRENT.md](CURRENT.md)，长期约定看 [SYSTEM.md](SYSTEM.md)，原始逐条记录保留在
`docs_legacy/HANDOFF.md`（不进 Git）。每节都给出旧 HANDOFF 位置，避免 AI 将历史提案误当
当前指令。

## 0.0.17-snapshot：文档与实现的交接基线

0.0.14–0.0.17 的改动被追加进旧 HANDOFF §25；标题仍写 0.0.14，但实际包含台后、ledger、
Garmin、开发启动保护等。它是证据档案，不再作为日常入口。本轮将仍有效的结论提炼到
`SYSTEM.md`、`DEV.md` 和 `CURRENT.md`；未迁移的细节保留原文，不应凭摘要删除。

## Garmin SSO 封禁事故

**结论：同步路径必须零 SSO；token 是资产，禁止自动删除。**

2026-08-04，开发中把直连、系统代理和多个端口与多种 `Garmin.login()` 策略交叉重试。一轮
手动同步可能发出数十次 SSO 请求，触发 Garmin 账号/API 登录端点 429 临时封禁；网页/App
仍可登录不代表 API 已恢复。失败登录会延长封禁，通常至少 24–48 小时，个案可达 72 小时。

同一事故还暴露出一组不可重试的错误：

- 用 username 伪造 `display_name` 继续同步，写入全 `null` 数据；
- token 失效或失败时建议/自动删除 `garmin_tokens.json`，使用户失去可用凭据；
- `requests.Session` 猴子补丁递归，产生 `maximum recursion depth exceeded`；
- 只要错误文本含 proxy 就报代理故障，覆盖真实 429；
- 把本地冷却误作服务端解封，或用 `TOKEN_ONLY` 阻断无 token 用户的显式重登录。

后续定案为两个入口：`garmin_sync` 仅 token refresh/拉取，缺 token 直接 `no_token`；
`garmin_login` 才能由用户显式触发一次受控 SSO。429 时停止，不得靠换路由、换端口或反复点击
“试试”。恢复自动同步前须先验证 token 稳定。旧 HANDOFF：§25.0.13–§25.0.14；具体开发规则见
[DEV.md](DEV.md#garmin最高优先级安全约束)。

## Dialog 层叠 P0 事故

2026-08-06，AI 对话删除确认与设置弹窗分别挂在 `#app`、`body`，共享 `z-index:200`；设置虽
视觉关闭却仍留在 DOM 中。透明设置层因 DOM 顺序覆盖确认框，导致鼠标命中主题色 tooltip，
点击“删除”实际改变主题且对话删不掉。多个 `mountConfirmDialog()` 实例和 click-through 延迟
恢复交互扩大了问题。

定案：所有 modal 进唯一的 `#orbita-modal-root`，使用 `openDialog`，确认框仅一份
`getConfirmDialog()` 单例；关闭必须 `hidden`，隐藏层不得响应 tooltip，打开 modal 立即解除
click-through。**不要为了局部方便重新直接 append backdrop。**旧 HANDOFF §25.0.29.1。

## 网格拖拽：已废弃虚拟位移路线

书签/应用曾从 DOM+FLIP 改为“body ghost + `applyVirtualShift` + slot 数学 + 松手一次提交”，
试图降低全网格布局压力。结果出现卡顿、预览落点不一致、folder transform 影响 fixed ghost、
dropzone 与中心归入/合并互相干扰等问题。用户反馈后，该路线被整文件删除。

当前做法是 DOM `insertBefore` + FLIP 实时预览，采用明确中心区处理归入/合并；folder 内拖出
越界即提交。不得从旧节复制 `measureGrid`、`slotIndexFromPoint`、`applyVirtualShift` 或 dwell
状态机回到代码里。旧 HANDOFF §17.5 是废弃路线，§17.11 才是当前定案；回归路径见 §17.7。

## 不纳入 Orbita 的硬件温度方案

0.0.10 曾尝试把 LibreHardwareMonitor（LHM）捆绑进应用以显示 CPU 温度，已明确放弃并回滚：
LHM 0.9.6 没有预期 WMI provider，HTTP 8085 又依赖用户手工开启 Web Server；自动启动会带来多
实例、权限、进程清理和构建占用问题。当前只保留 `sysinfo` 的 CPU/内存，用户如需温度使用
独立 LHM。不要重新加 WMI、LHM spawn、`taskkill` 或 bundle resource，除非维护者明确重新立项。
旧 HANDOFF §21.1、§21.3–§21.4。

## Ledger：启动和数据根错误的两次教训

初版在 app boot 时启动 sidecar，并以 `let _ = ...` 吞掉错误；前端 invoke 失败后硬回退 8000。
这让主 HUD 无故拉起 Python，也让缺 venv、错误 cwd 或启动失败变成无信息的“连不上”。后改为
台后/资产按需启动、错误和 stderr 写入 `%TEMP%/orbita-ledger.log`，且端口只能由 Rust 返回。
台后打开最终又调整为乐观显示窗口，sidecar 在后台启动，避免健康检查阻塞窗口。旧 HANDOFF
§25.0.32、§25.0.36。

第二次，dataDir 改为正确目录且 bean 文件合规时，8000 上的孤儿 uvicorn 仍被复用，继承旧
`ORBITA_LEDGER_DATA_ROOT`。health 成功但 accounts 全空，前端误报“账本未就绪”；“重试”也未
重启进程。定案是不采纳陌生 health 进程，记录 child 与 data root、检测 stale 后重启，重试也
强制 restart。账本格式以 `account.bean`、`category.bean`、`ledger/*.bean` 为准；不要把这类
运行时错位误诊为格式错误。旧 HANDOFF §25.0.40。

## 数据目录切换不是迁移

切换 `dataDir` 的语义是保存新 bootstrap/settings 并在新目录读取数据，**不复制或移动**旧
书签、journal、AI 或 bill。前台和台后是独立 webview，单一 `CustomEvent` 不会跨窗口；因此
切换时必须发 Tauri event、刷新各数据域，并重启 ledger sidecar。Web 预览的 localStorage 也
必须按 `dataDir` 分桶，否则切空目录仍会显示旧数据。旧 HANDOFF §25.0.39.5–§25.0.39.8。

## 开发模式拒绝连接

终端/Cursor 死掉可停 Vite，却留下 `orbita.exe`；旧 Vite 占 1420 又会令新的 `beforeDevCommand`
失败，于是 WebView 显示 `ERR_CONNECTION_REFUSED`。解决方案是 `dev-clean.ps1`、`dev.bat` 的
清理和失败重启、debug Vite 恢复时的 webview reload、Vite 绑定 `127.0.0.1`。不要把此现象归因
于 cargo warning 或只重开窗口。旧 HANDOFF §25.0.42；具体恢复命令见 [DEV.md](DEV.md)。

## 历史交互决策（仍有效）

- 书签和应用保持**网格**，不是列表；folder 为锚定毛玻璃浮层、4 宫格预览、标题双击内联改名。
  旧 HANDOFF §17.9、§17.11。
- 删除操作仍应有确认；曾把删除擅改成右键菜单，已回滚。旧 HANDOFF §22.8。
- 五大区布局不能把今日区和工作区包成同一个 flex 容器，也不能用单行三列 grid 代替定位布局；
  否则第二行与右侧任务区的高度/对齐会崩。旧 HANDOFF §25.0.2。
- 主心情挂在 `#primaryMoodMount`，不要塞进搜索栏；否则挤压搜索输入。旧 HANDOFF §25.0.2。

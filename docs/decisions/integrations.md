# Orbita Health、AI 与 Work：已定案

## 1. Orbita Health / Garmin：同步路径零 SSO

**当前结论**：同步、自动同步、Agent 同步只可 load token → refresh → 拉取数据；没有 token 返回 `no_token`，失效返回 `token_invalid`，由用户显式重新登录。SSO 只允许显式登录入口单路由、单次尝试；429 后本地冷却并停止。Garmin 是 Health 的外部来源，不是产品页面名称。

**绝对禁止**：同步失败 fallback SSO；多路由/多代理/多策略登录风暴；删 token 逼重登；username 冒充 `display_name`；用 stderr 关键字猜错误；未经脚本与 `dev.bat` 实测宣称修复。

**数据规则**：Garmin 单向写入；同步 daily 必须保留 meals；睡眠归醒来日，保留 naps；手录喝水和吃饭不上行 Garmin。完整事故经过在 `HISTORY.md`。

**历史证据**：legacy HANDOFF §25.0.0、§25.0.5、§25.0.7–.15。

## 2. AI：确认、流式与事实边界

Journal 写/删、Garmin sync 和未来 Finance 写入必须确认；查询/摘要可直接执行。工具步骤不落盘，对话只保存最终 assistant 内容。流式仅更新最后一条，停止时立即 abort/解锁，缓存按 conversation 管理。

**禁止回退**：不得因“AI 已懂用户意思”移除生活数据写确认；不得把未实现 Finance 写入伪装成可用；不得让 AI 推断冒充 Archive 事实。

**历史证据**：legacy HANDOFF §25.0、§25.0.1、§25.0.7、§25.0.15–.16。

## 3. Orbita Work / TickTick

TickTick 是 Orbita Work 的外部连接，不是 Work 本身。完成任务立即发 API，使用 3 秒浮动 undo；due 改期未指定 start 时同步平移 start，越过 due 则对齐 due。代码改名或兼容改动必须全仓检查并实测 OAuth、列表、完成、撤销和 Agent。

**历史证据**：legacy HANDOFF §25.0.16、§25.0.21–.22、§25.0.29.2。

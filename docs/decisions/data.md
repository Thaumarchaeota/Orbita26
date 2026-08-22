# Orbita Archive 与数据目录：已定案

## 1. 当前数据根

**当前结论**：`dataDir` 是当前实际数据根，同时承载 App State 与 Orbita Archive 的早期数据。应用设置、书签、应用、本地项、AI、Journal、缓存、凭据与当前 Finance 数据都必须随它读写。未来 `archiveRoot` 是架构方向，不是现有字段或迁移授权。

**禁止回退**：不得把业务数据放回项目目录、安装目录、用户家目录惯例路径，或新增不受 `dataDir` 分桶的全局 `localStorage` key。不得以未来架构为理由自动拆根、复制、移动或重建用户数据。

## 2. dataDir 切换

**当前结论**：Insight 中的设置是 `dataDir` 唯一 UI 入口。保存新目录写 bootstrap 指针与该目录 settings，可创建目录；不复制、不移动旧书签、Journal、AI 或 Finance 数据。切换后必须跨窗口通知、重载用户数据、rebase 旧根下的可重置路径，并重启 Finance Service。

**禁止回退**：不得恢复 Panel 的第二个入口；不得只派发 DOM `CustomEvent` 或只刷新一个窗口；不得实现静默自动搬家。未来迁移向导必须独立设计、用户确认并验证可回退性。

**历史证据**：legacy HANDOFF §25.0.39.1、.3–.7、.9–.10。

## 3. Archive 的领域独立性

**当前结论**：Orbita Archive 保存或稳定指向个人事实，但不把 Journal、Health、Finance、Knowledge、Media 压成万能 Event 模型。跨领域关联仍是待设计方向；不得假装已实现 Connection、Semantic 或 `archiveRoot`。

**禁止回退**：不得将 AI 推断、缓存或统计当作档案事实；不得为“统一”破坏 Journal、bean/Beancount、Garmin 等领域语义。详见 `architecture/data-layer-vision.md`。

## 4. 隐私、凭据与公开边界

**当前结论**：settings、credentials、token、rate-limit、缓存、用户数据、`docs_legacy/` 和外部 `reference/` 不进公开 Git。token 是可恢复会话资产；不能把 token 塞进新 secrets 文件或建议删除 token 作为常规排错。

**历史证据**：legacy HANDOFF §25.0.3、§25.0.13–.14、§25.0.17。

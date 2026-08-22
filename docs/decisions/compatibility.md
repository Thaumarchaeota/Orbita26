# 兼容性护栏：已定案

这些内容容易被“清理旧代码”误伤。它们不代表优雅的最终形态，而是当前仍需保留或谨慎替换的兼容边界。

## 1. 设置、旧数据与 Web 预览

- Rust 是 Tauri 默认值与关键 settings/grid 迁移的唯一来源；TypeScript 在 Tauri 下不重复迁移，Web fallback 才可有受控兼容路径。
- Web 预览使用的 localStorage 必须按 `dataDir` 分桶；不得新增不受数据根隔离的全局 key。
- `core/settings.ts` 的纯 re-export 是有意兼容层；删除前必须审计所有 import 与运行行为。

## 2. 外部协议与本地路径

- `zotero://`、`obsidian://` 等协议和本地路径由 Rust 的外部打开路径处理；WebView/plugin opener 对这些协议不可靠。
- v2rayN 需经 `cmd /C start` 脱离 Orbita Job 生命周期；不得改回普通 spawn 或无验证的 breakaway flag。
- 本地文件 picker 的阻塞调用必须经 async + `spawn_blocking`，否则会阻塞主线程。

## 3. 图标、缓存与数据访问

- 应用图标使用 data URL；不要恢复 `convertFileSrc` / Tauri asset 路径，WebView2 曾因此白屏。
- favicon 与文件图标缓存属于 dataDir；缺失补抓只能 idle，不能阻塞首屏。
- Zotero 读取 immutable SQLite；文献到 Obsidian 的匹配经子笔记 key，不能把文献 key 或 PDF 附件 key 当 Markdown 文件名。

## 4. 证据与变更门槛

这些约束来自 legacy HANDOFF §2.0.3–.7、§4.7、§17.16、§25.0.5、§25.0.16、§25.0.29.4。若替换其中任一项，必须在 plan 中列出旧行为、迁移路径与对应实机回归，不能仅凭静态审查删除。

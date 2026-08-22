# Orbita Panel、Orbita Insight 与交互：已定案

## 1. 两个界面

**当前结论**：Orbita 是单一 Tauri 应用。Orbita Panel（代码 `main`）与 Orbita Insight（代码 `admin`）是同进程的两个 webview 窗口；现行文档与 UI 使用这两个名称。Insight 不加载 Panel 的 shell CSS、click-through 或 integrations，启动必须同步轻量。

Insight 关闭时 `prevent_close() + hide()`，再次打开 `show()+focus()` 复用同一 webview；不得 destroy 后重建。Insight 使用 admin 专属 frame：左侧 drag、右侧控制区可点；每次打开重建 overlay titlebar。main/admin 都显式设置同一运行时图标。

**禁止回退**：不得拆成第二个应用/NAS Web；不得阻塞打开等待 Finance Service；不得整行 drag、destroy/rebuild admin、将 Panel theme bridge 强绑 Insight，或以托盘正确推断 Insight 任务栏正确。

**历史证据**：legacy HANDOFF §25.0.30、§25.0.34–.38、§25.0.41。

## 2. Dialog 与 click-through

新 dialog 统一走 `#orbita-modal-root` 和既有 motion 生命周期；confirm 是全局单例。透明窗口在 overlay/modal 打开时必须 `ensureWindowInteractive`，关闭后才恢复；Esc、获焦与轮询失败都有强制可点兜底。

**禁止回退**：不得 append backdrop 到任意 `#app`/body、opacity-only close、重复 mount confirm、缩小 click-through 白名单或只靠 CSS z-index 解决原生鼠标忽略。

**历史证据**：legacy HANDOFF §25.0.11、§25.0.29.1–.5。

## 3. 拖拽与今日区

应用格是稠密 Pointer+FLIP 状态机；书签/本地是树拖拽，不能“统一成一个实现”。不得恢复固定空槽、HTML5 DnD、拖出时立即提交或提前释放 pointer capture。今日三环固定为睡眠/摄入-消耗/喝水；餐食保存在 daily meals，不拆独立 journal kind。

**历史证据**：legacy HANDOFF §17.11、§17.13、§25.0.11、§25.0.20、§25.0.28–.29。

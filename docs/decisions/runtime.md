# 运行时、开发与兼容性：已定案

## 1. 开发入口与验证

`dev-web.bat` 只作 UI 快速预览；不能验证 IPC、窗口、OAuth、外部协议、Finance Service 或系统能力。每次代码修改结束前必须运行 `orbita/dev.bat` 并确认无报错；未经用户允许不运行 build 或 `cargo check`。两个 dev 入口不能同时占用 1420。

`dev-clean`、strict port、dev 崩溃重启与 Vite 恢复 reload 是实际故障保护，不能以“冗余”删除。终端关闭会让 Vite 停止而旧窗口仍存活，导致 `ERR_CONNECTION_REFUSED`。

## 2. 唤醒与兼容性

休眠后的 WebView2 可能真实挂掉：托盘显示总 reload，隐藏/失焦较久后回来 reload；短 Alt+Tab 只修 DWM/chrome。Tauri dev capability 必须允许 localhost 1420。外部协议与本地路径经 Rust 打开；图标使用 data URL，文件 picker 用 async/spawn_blocking。

**禁止回退**：不得删除 wake repair、恢复 `convertFileSrc` 图标、阻塞主线程 picker，或以 plugin opener 取代不可靠的自定义协议路径。

**历史证据**：legacy HANDOFF §23.2、§25.0.21、§25.0.27、§25.0.42；§2.0.3–.7、§4.7。

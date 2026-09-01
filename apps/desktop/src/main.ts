import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./core/data/client";

function isAdminWindow(): boolean {
  if (new URLSearchParams(location.search).get("app") === "admin") return true;
  // Vite preview deliberately runs without Tauri internals. Do not make the
  // desktop-window lookup a prerequisite for rendering the web preview.
  return isTauri() && getCurrentWindow().label === "admin";
}

function renderEntryFailure(error: unknown): void {
  console.error("Orbita entry module failed", error);
  const root = document.getElementById("app");
  if (!root) return;
  // The native main window is intentionally transparent. Keep an entry-module
  // failure visible instead of presenting a fully transparent empty window.
  root.replaceChildren();
  const panel = document.createElement("pre");
  panel.style.cssText = "min-height:100vh;margin:0;padding:32px;background:#f8fafc;color:#b42318;font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap";
  let message = error instanceof Error ? error.message : String(error);
  if (/Failed to fetch dynamically imported module/i.test(message)) {
    message += "\n\nVite 开发服务不可达：请运行 apps/desktop/dev.bat，等待终端出现 Vite ready 后再打开窗口。";
  }
  panel.textContent = `Orbita 启动模块失败\n${message}`;
  root.appendChild(panel);
}

if (isAdminWindow()) {
  void import("./apps/admin/main").catch(renderEntryFailure);
} else {
  void import("./apps/shell/main").catch(renderEntryFailure);
}

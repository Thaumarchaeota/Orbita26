import { getCurrentWindow } from "@tauri-apps/api/window";

function isAdminWindow(): boolean {
  if (new URLSearchParams(location.search).get("app") === "admin") return true;
  return getCurrentWindow().label === "admin";
}

if (isAdminWindow()) {
  void import("./apps/admin/main");
} else {
  void import("./apps/shell/main");
}

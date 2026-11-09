import { closeInsightContentTab, openInsightContentTab } from "../tab-host/host-api";

export function openInsightSettings(): void {
  openInsightContentTab({ kind: "settings" }, "设置");
}

export function closeInsightSettings(): void {
  closeInsightContentTab("settings");
}

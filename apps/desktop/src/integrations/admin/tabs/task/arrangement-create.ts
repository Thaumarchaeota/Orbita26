import {
  commandMenuItemsFromLegacy,
  showCommandMenuAt,
  type MenuItemDef,
} from "../../../../ui/command-menu-popover";
import type { Target } from "./arrangement-model";

export type ArrangementCreationChoice = { kind: "session" | "new-item" | "item" | "task"; id?: string };

/** Shared choice flow for Timeline and the week grid; creation itself stays with the caller's domain adapter. */
export function chooseArrangementCreation(targets: Iterable<Target>, allowSession: boolean): Promise<ArrangementCreationChoice | null> {
  return new Promise((resolve) => {
    void targets;
    let settled = false;
    const finish = (value: ArrangementCreationChoice | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const left = Math.max(12, Math.min(window.innerWidth - 250, Math.round(window.innerWidth / 2 - 125)));
    const top = Math.max(12, Math.min(window.innerHeight - 190, Math.round(window.innerHeight / 2 - 95)));
    const defs: MenuItemDef[] = [
      ...(allowSession ? [{ action: "session", label: "新建工作时间" }] : []),
      { action: "new-item", label: "新建任务" },
      { action: "item", label: "关联任务（暂不可用）" },
      { action: "task", label: "关联项目任务（暂不可用）" },
    ];
    showCommandMenuAt(left, top, commandMenuItemsFromLegacy(defs), (action) => {
      if (action === "item" || action === "task") {
        finish(null);
        return;
      }
      if (action === "session") {
        finish({ kind: "session" });
        return;
      }
      finish({ kind: "new-item" });
    }, { onClose: () => finish(null) });
  });
}

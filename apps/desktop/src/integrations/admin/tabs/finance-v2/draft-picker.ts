import { mountSelectField, type SelectFieldHandle } from "../../../../ui/select-field";
import type { FinanceDraftListEntryView } from "../../../finance-v2/types";

export function mountFinanceDraftPicker(
  container: HTMLElement,
  entries: FinanceDraftListEntryView[],
  selectedId: string | null,
  onChange: (draftId: string | null) => void,
): SelectFieldHandle {
  return mountSelectField(container, {
    label: "选择工作区草稿",
    placeholder: "请选择一个工作区草稿",
    search: true,
    multiple: false,
    value: selectedId,
    options: entries.map((entry) => ({
      value: entry.draftId,
      label: entry.draftId + " · " + (entry.workspaceKind === "ManualOnly" ? "手工" : "导入")
        + " · " + draftStateLabel(entry.state) + " · " + formatUpdatedAt(entry.updatedAtUtcUs) + " · r" + entry.durableRevision,
      disabled: entry.state === "Finalized" || entry.state === "Abandoned" || entry.state === "Corrupt",
    })),
    onChange,
  });
}

export function draftStateLabel(state: FinanceDraftListEntryView["state"]): string {
  switch (state) {
    case "Open": return "编辑中";
    case "Prepared": return "已预校验";
    case "Committed": return "已提交";
    case "Finalized": return "已完成";
    case "Abandoned": return "已放弃";
    case "Corrupt": return "数据损坏";
  }
}

function formatUpdatedAt(value: FinanceDraftListEntryView["updatedAtUtcUs"]): string {
  if (value == null) return "更新时间不可用";
  try {
    const millis = Number(BigInt(String(value)) / 1000n);
    return Number.isFinite(millis) ? new Date(millis).toLocaleString() : "更新时间不可用";
  } catch {
    return "更新时间不可用";
  }
}

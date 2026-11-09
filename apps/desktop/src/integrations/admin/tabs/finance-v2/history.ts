import { mountSelectField } from "../../../../ui/select-field";
import type { FinanceV2Backend, IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, el, section, setStatus, statusNode, textField } from "./dom";

export function mountHistory(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession): { dispose(): void } {
  const block = section("历史变更", "显示已保存字段前后、来源来历与关系变化。撤销未提交草稿不会回滚此处的正式历史。");
  const table = el("table", "finance-v2-table");
  const status = statusNode();
  const kindHost = el("div", "finance-v2-field-host");
  const kind = mountSelectField(kindHost, { label: "历史对象类型", placeholder: "选择对象类型", options: [
    ["account", "Account"], ["via", "Via"], ["l0", "账本事实"], ["treatment", "Treatment"],
    ["calibration", "校准"], ["source_context", "来源主体"], ["source_binding", "来源绑定"], ["evidence_link", "证据链接"],
  ].map(([value, label]) => ({ value, label })), search: false, multiple: false, value: null, onChange: () => {} });
  const id = textField("对象 ID");
  const refresh = async (button?: HTMLButtonElement) => {
    const entityKind = kind.getValue(); const entityId = id.input.value.trim();
    if (!entityKind || !entityId) { setStatus(status, "请选择对象类型并填写精确对象 ID。", "error"); return; }
    if (button) button.disabled = true;
    try {
      const rows = await backend.listHistory(session, entityKind as Parameters<FinanceV2Backend["listHistory"]>[1], entityId);
      if (disposed) return;
      const head = el("thead"); const headRow = el("tr");
      for (const label of ["时间", "对象/版本", "字段", "之前", "之后", "来历/关系"]) headRow.append(el("th", "", label));
      head.append(headRow);
      const body = el("tbody");
      for (const row of rows) {
        const tr = el("tr");
        for (const value of [row.recordedAt, `${row.entity} · r${row.revision}`, row.field, row.before || "—", row.after || "—", [row.provenance, row.relationChange].filter(Boolean).join(" · ") || "—"]) tr.append(el("td", "", value));
        body.append(tr);
      }
      table.replaceChildren(head, body);
      setStatus(status, rows.length ? `显示 ${rows.length} 条历史记录。` : "当前对象没有历史记录。", "info");
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { if (button) button.disabled = false; }
  };
  const load = action("读取此对象历史", async (button) => refresh(button));
  block.append(kindHost, id.root, load, table, status); root.append(block);
  let disposed = false;
  return { dispose() { disposed = true; kind.dispose(); root.replaceChildren(); } };
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

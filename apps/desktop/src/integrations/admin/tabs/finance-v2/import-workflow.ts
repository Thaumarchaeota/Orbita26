import { mountSelectField, type SelectFieldHandle } from "../../../../ui/select-field";
import { createChoiceCheckbox, setTriStateMarker } from "../../../../ui/choice-control";
import { mountLoadingIndicator } from "../../../../ui/loading-indicator";
import { FINANCE_V2_SOURCE_PROFILES, type FinanceV2Backend, type FinanceImportBatchView, type FinanceImportRowView, type FinanceSourceContextView, type IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, el, section, setStatus, statusNode } from "./dom";

export function mountImportWorkflow(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession, onBatch: (batch: FinanceImportBatchView | null) => void, initialBatch: FinanceImportBatchView | null = null): { dispose(): void } {
  const block = section("导入来源文件", "解析结果先展示并由你确认固定观察；失败项可留在批次中查看，不会被当成成功。取消任务不会确认或提交账本事实。");
  const contextHost = el("div", "finance-v2-field-host");
  const profileHost = el("div", "finance-v2-field-host");
  const status = statusNode();
  const rowsHost = el("div", "finance-v2-list");
  const controls = el("div", "finance-v2-actions");
  const progressHost = el("div");
  const progress = mountLoadingIndicator(progressHost, { size: "inline", label: "正在解析…" });
  const disposers: Array<() => void> = [() => progress.dispose()];
  let contextSelect: SelectFieldHandle | null = null;
  let profileSelect: SelectFieldHandle | null = null;
  let contexts: FinanceSourceContextView[] = [];
  let batch: FinanceImportBatchView | null = initialBatch;
  let accepted = new Set<string>(initialBatch?.rows.filter((row) => row.quality === "Confirmed").map((row) => row.itemId) ?? []);
  let parseController: AbortController | null = null;
  const cancel = action("停止等待并丢弃结果", async () => { parseController?.abort(); }, true);
  const parse = action("选择文件并解析", async (button) => {
    const contextId = contextSelect?.getValue();
    const context = contexts.find((item) => item.id === contextId && item.active);
    const profileId = profileSelect?.getValue();
    if (!context || !profileId) { setStatus(status, "请选择已启用来源主体与受支持的 Profile。", "error"); return; }
    parseController?.abort();
    parseController = new AbortController();
    cancel.disabled = false;
    button.disabled = true;
    progress.setLoading(true, "请在系统文件选择器中选择来源文件…");
    try {
      batch = await backend.pickAndParse(session, context.id, context.revision, profileId, (message) => progress.setLoading(true, message), parseController.signal);
      accepted = new Set(batch.rows.filter((row) => row.quality === "Confirmed").map((row) => row.itemId));
      renderRows(); onBatch(null);
      setStatus(status, `解析已完成：${batch.rows.length} 行；${accepted.size} 行为已确认观察。下一步需明确确认本批。`, "success");
    } catch (error) {
      if (parseController.signal.aborted) setStatus(status, "已丢弃本次解析结果；未确认观察或创建草稿。隔离材料可能已由受控解析命令暂存。", "info");
      else setStatus(status, errorText(error), "error");
    } finally { progress.setLoading(false); button.disabled = false; cancel.disabled = true; }
  });
  const confirm = action("确认所选解析行", async (button) => {
    if (!batch || !accepted.size) { setStatus(status, "请至少选择一条成功解析的来源行。", "error"); return; }
    button.disabled = true;
    try {
      const frozen = await backend.confirmParsedBatch(session, batch, [...accepted]);
      const durable = await backend.saveDraft(session, frozen);
      batch = { ...frozen, draftRevision: durable.revision, durableRevision: durable.durableRevision };
      onBatch(batch);
      setStatus(status, `已确认 ${accepted.size} 行；草稿持久版本 ${batch.durableRevision}/${batch.draftRevision}。`, "success");
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  cancel.disabled = true;
  controls.append(parse, cancel, confirm);
  block.append(contextHost, profileHost, controls, progressHost, rowsHost, status);
  root.append(block);
  profileSelect = mountSelectField(profileHost, {
    label: "来源 Profile", placeholder: "选择精确解析布局", options: FINANCE_V2_SOURCE_PROFILES.map((profile) => ({ value: profile.id, label: profile.label })),
    search: true, multiple: false, value: null, onChange: () => {},
  });
  void backend.loadSourceContexts(session).then((rows) => {
    contexts = rows.filter((item) => item.active);
    contextSelect?.dispose();
    contextSelect = mountSelectField(contextHost, {
      label: "稳定来源主体", placeholder: "选择账户/产品范围", options: contexts.map((context) => ({ value: context.id, label: `${context.label} · ${context.provider} · ${context.scope}` })),
      search: contexts.length > 6, multiple: false, value: null, onChange: () => {},
    });
    if (!contexts.length) setStatus(status, "当前隔离账本没有启用的来源主体。请先到账户与来源页创建主体，再开始解析。", "info");
  }).catch((error) => setStatus(status, errorText(error), "error"));

  const renderRows = () => {
    rowsHost.replaceChildren();
    if (!batch) return;
    for (const row of batch.rows) {
      const item = el("article", "finance-v2-row");
      const check = createChoiceCheckbox(accepted.has(row.itemId) ? "checked" : "unchecked");
      check.setAttribute("aria-label", `选择来源行 ${row.locator}`);
      check.disabled = row.quality !== "Confirmed";
      check.addEventListener("click", () => {
        if (accepted.has(row.itemId)) accepted.delete(row.itemId); else accepted.add(row.itemId);
        setTriStateMarker(check, accepted.has(row.itemId) ? "checked" : "unchecked");
      });
      const content = el("div", "finance-v2-row-content");
      content.append(el("strong", "finance-v2-row-title", `${row.merchant || "未识别商户"} · ${row.amountText} ${row.commodity}`));
      content.append(el("span", "finance-v2-muted", `${row.locator} · ${qualityLabel(row.quality)}${row.summary ? ` · ${row.summary}` : ""}`));
      item.append(check, content); rowsHost.append(item);
    }
  };
  renderRows();
  return {
    dispose() { parseController?.abort(); for (const dispose of disposers) dispose(); contextSelect?.dispose(); profileSelect?.dispose(); root.replaceChildren(); },
  };
}

function qualityLabel(row: FinanceImportRowView["quality"]): string {
  if (row === "Confirmed") return "已确认观察";
  if ("unresolved" in row) return `待核实：${row.unresolved}`;
  return `解析失败：${row.failed}`;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

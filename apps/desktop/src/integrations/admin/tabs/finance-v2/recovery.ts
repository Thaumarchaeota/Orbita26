import { createInsightDialog } from "../../../../ui/insight-dialog";
import { mountLoadingIndicator } from "../../../../ui/loading-indicator";
import type { FinanceDraftListEntryView, FinanceDraftStatusView, FinanceImportBatchView, FinanceV2Backend, IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, confirmAction, el, section, setStatus, statusNode } from "./dom";
import { mountFinanceDraftPicker } from "./draft-picker";

export function mountRecovery(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession, batch: FinanceImportBatchView | null, onCommitted?: () => void): { dispose(): void } {
  const block = section("提交与恢复", "预校验与物化状态来自隔离后端。提交失败或物化待修复时保留 receipt；修正必须创建新 operation。");
  const status = statusNode();
  const output = el("pre", "finance-v2-identity");
  const progressHost = el("div");
  const pickerHost = el("div");
  const selectedInfo = el("p", "finance-v2-muted");
  const progress = mountLoadingIndicator(progressHost, { size: "inline", label: "工作中…" });
  let current: FinanceDraftStatusView = { draftId: batch?.draftId ?? null, revision: batch?.draftRevision ?? 0, durableRevision: batch?.durableRevision ?? 0, commitState: "Unprepared", generation: session.generation };
  let entries: FinanceDraftListEntryView[] = [];
  let selectedId: string | null = batch?.draftId ?? null;
  let picker: ReturnType<typeof mountFinanceDraftPicker> | null = null;
  const statusFromEntry = (entry: FinanceDraftListEntryView | undefined): FinanceDraftStatusView => {
    if (!entry) return { draftId: null, revision: 0, durableRevision: 0, commitState: "Unprepared", generation: session.generation };
    const commitState = entry.state === "Prepared" ? "Prepared" : entry.state === "Committed" || entry.state === "Finalized" ? "Committed" : "Unprepared";
    return { draftId: entry.draftId, revision: entry.durableRevision, durableRevision: entry.durableRevision, commitState,
      operationId: entry.operationId, receiptId: entry.receiptId, generation: session.generation,
      pendingMaterialization: entry.state === "Committed" ? "receipt 已存在；需恢复物化并完成工作区 finalize。" : undefined,
      manualOnly: entry.workspaceKind === "ManualOnly", draftState: entry.state };
  };
  const refresh = async () => {
    entries = await backend.listDrafts(session);
    const active = entries.filter((entry) => entry.state === "Open" || entry.state === "Prepared" || entry.state === "Committed");
    if (!selectedId || !entries.some((entry) => entry.draftId === selectedId)) selectedId = active.length === 1 ? active[0].draftId : null;
    current = statusFromEntry(entries.find((entry) => entry.draftId === selectedId));
    picker?.dispose(); picker = null; pickerHost.replaceChildren();
    if (entries.length) picker = mountFinanceDraftPicker(pickerHost, entries, selectedId, (draftId) => {
      selectedId = draftId;
      current = statusFromEntry(entries.find((entry) => entry.draftId === selectedId));
      paint();
    });
    paint();
  };
  const selectedBatch = (): FinanceImportBatchView | null => current.draftId ? {
    draftId: current.draftId, draftRevision: current.revision, durableRevision: current.durableRevision,
    baseGeneration: current.generation, rows: [], manualOnly: current.manualOnly,
  } : null;
  const prepare = action("预校验本批", async (button) => {
    const selected = selectedBatch();
    if (!selected || current.draftState !== "Open") { setStatus(status, "请选择一个仍处于编辑状态的草稿。", "error"); return; }
    button.disabled = true; progress.setLoading(true, "正在校验版本、引用与账本投影…");
    try {
      const result = await backend.prepareCommit(session, selected);
      current = result.status; await refresh();
      setStatus(status, result.errors.length ? `预校验阻断：${result.errors.join("；")}` : "预校验通过；尚未提交。", result.errors.length ? "error" : "success");
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { progress.setLoading(false); button.disabled = false; }
  });
  const commit = action("确认提交", async (button) => {
    const selected = selectedBatch();
    if (!selected || current.commitState !== "Prepared") { setStatus(status, "请先选择并通过预校验。", "error"); return; }
    button.disabled = true;
    try {
      const dialog = createInsightDialog({ title: "提交隔离账本", bodyHtml: "<p>将按已预校验的 operation 写入当前显式隔离 session。确认后可能产生正式 receipt。</p>", submitLabel: "确认提交", mountTarget: root });
      dialog.bindChrome(() => { void dialog.close().then(() => dialog.dispose()); });
      dialog.panel.addEventListener("submit", (event) => {
        event.preventDefault(); if (dialog.busy) return; dialog.setBusy(true);
        progress.setLoading(true, "提交中…");
        void backend.commitPrepared(session, selected).then(async (value) => {
          current = value; await refresh(); current = value; paint();
          onCommitted?.();
          setStatus(status, value.pendingMaterialization ? "已提交并保留 receipt；物化待修复，请使用恢复操作。" : "提交与物化已完成，receipt 已记录。", value.pendingMaterialization ? "error" : "success");
          return dialog.close().then(() => dialog.dispose());
        }).catch((error) => dialog.setError(errorText(error))).finally(() => { progress.setLoading(false); dialog.setBusy(false); });
      });
      await dialog.open();
    } finally { button.disabled = false; }
  });
  const retry = action("重试物化", async (button) => {
    if (!current.operationId || !current.pendingMaterialization) { setStatus(status, "当前没有待修复的已提交 operation。", "error"); return; }
    button.disabled = true;
    try {
      const repaired = await backend.retryMaterialization(session, current.operationId);
      if (repaired.draftId) selectedId = repaired.draftId;
      await refresh(); current = repaired; paint();
      if (!repaired.pendingMaterialization) onCommitted?.();
      setStatus(status, repaired.pendingMaterialization ? "修复仍未完成，请保留 receipt 并检查错误。" : "当前 generation 物化与草稿 finalize 已完成。", repaired.pendingMaterialization ? "error" : "success");
    }
    catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  const abandon = action("放弃未提交草稿", async () => {
    if (!current.draftId || current.draftState !== "Open") { setStatus(status, "只有仍处于编辑状态的草稿可以放弃。", "error"); return; }
    await confirmAction(root, "放弃未提交草稿", "只删除确认没有 receipt 的未提交工作内容。", "放弃草稿", async () => {
      await backend.abandonUnsubmittedDraft(session, current.draftId!); selectedId = null;
      await refresh().catch((error) => setStatus(status, errorText(error), "error"));
    });
  });
  block.append(pickerHost, selectedInfo, el("div", "finance-v2-actions"), progressHost, output, status);
  block.querySelector(".finance-v2-actions")!.append(prepare, commit, retry, abandon);
  root.append(block);
  const paint = () => {
    const entry = entries.find((item) => item.draftId === selectedId);
    selectedInfo.textContent = entry ? "草稿 " + entry.draftId + " · " + (entry.workspaceKind === "ManualOnly" ? "手工工作区" : "导入工作区")
      + " · " + entry.state + " · 持久版本 r" + entry.durableRevision : "请选择一个可继续的草稿；已完成或已放弃草稿仅供识别。";
    prepare.disabled = !entry || entry.state !== "Open";
    commit.disabled = !entry || entry.state !== "Prepared";
    retry.disabled = !current.pendingMaterialization;
    abandon.disabled = !entry || entry.state !== "Open";
    output.textContent = JSON.stringify(current, null, 2);
  };
  paint(); void refresh().catch((error) => setStatus(status, errorText(error), "error"));
  return { dispose() { picker?.dispose(); progress.dispose(); root.replaceChildren(); } };
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

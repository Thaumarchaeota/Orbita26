import { createInsightDialog } from "../../../../ui/insight-dialog";
import type { FinanceV2Backend, FinanceRuleView, IsolatedFinanceSession } from "../../../finance-v2/types";
import { action, el, section, setStatus, statusNode } from "./dom";

export function mountRules(root: HTMLElement, backend: FinanceV2Backend, session: IsolatedFinanceSession): { dispose(): void } {
  const block = section("分类规则", "规则仅用于受限的分类建议。文件保存在当前隔离账本；覆盖保存和追加都按后端 revision/hash 做 CAS。");
  const editor = el("textarea"); editor.rows = 16; editor.spellcheck = false;
  const status = statusNode();
  let current: FinanceRuleView = { content: "", revision: 0, sha256: "" };
  let disposed = false;
  const reload = action("重新载入", async (button) => {
    button.disabled = true;
    try { current = await backend.loadRules(session); editor.value = current.content; setStatus(status, `已载入规则 r${current.revision} · ${current.sha256}`, "success"); }
    catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  const save = action("保存当前全文", async (button) => {
    button.disabled = true;
    try {
      current = await backend.saveRules(session, current.revision, current.sha256, editor.value);
      editor.value = current.content; setStatus(status, `已保存规则 r${current.revision} · ${current.sha256}`, "success");
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  const append = action("预览并确认追加", async (button) => {
    const pending = editor.value.trim();
    if (!pending) { setStatus(status, "请输入要追加的 Markdown。", "error"); return; }
    button.disabled = true;
    try {
      const preview = await backend.previewAppendRules(session, pending);
      const dialog = createInsightDialog({ title: "核对规则追加预览", bodyHtml: `<p>基于 r${preview.baseRevision} · ${escapeHtml(preview.baseSha256)}</p><p>追加内容 SHA-256：${escapeHtml(preview.appendSha256)}</p>`, submitLabel: "确认追加", mountTarget: root });
      dialog.body.append(el("pre", "finance-v2-rule-preview", preview.previewContent));
      dialog.bindChrome(() => { void dialog.close().then(() => dialog.dispose()); });
      dialog.panel.addEventListener("submit", (event) => {
        event.preventDefault(); if (dialog.busy) return; dialog.setBusy(true);
        void backend.confirmAppendRules(session, preview).then((next) => {
          current = next; editor.value = next.content; setStatus(status, `规则已追加，r${next.revision} · ${next.sha256}`, "success");
          return dialog.close().then(() => dialog.dispose());
        }).catch((error) => dialog.setError(errorText(error))).finally(() => dialog.setBusy(false));
      });
      await dialog.open();
    } catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  const openFile = action("在系统中打开隔离规则文件", async (button) => {
    button.disabled = true;
    try { await backend.openRulesFile(session); setStatus(status, "已请求打开当前隔离账本中的规则文件。", "success"); }
    catch (error) { setStatus(status, errorText(error), "error"); }
    finally { button.disabled = false; }
  });
  const controls = el("div", "finance-v2-actions"); controls.append(reload, save, append, openFile);
  block.append(editor, controls, status); root.append(block);
  void backend.loadRules(session).then((value) => { if (!disposed) { current = value; editor.value = value.content; } })
    .catch((error) => setStatus(status, errorText(error), "error"));
  return { dispose() { disposed = true; root.replaceChildren(); } };
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

import { createButton } from "../../../../ui/button";
import { createInsightDialog } from "../../../../ui/insight-dialog";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function action(label: string, callback: (button: HTMLButtonElement) => void | Promise<void>, disabled = false): HTMLButtonElement {
  const button = createButton(label, { width: 148, height: 38, fontSize: 13 });
  button.disabled = disabled;
  button.addEventListener("click", () => { void callback(button); });
  return button;
}

export function statusNode(): HTMLElement {
  const node = el("p", "finance-v2-status");
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  return node;
}

export function setStatus(node: HTMLElement, message: string, kind: "info" | "error" | "success" = "info"): void {
  node.textContent = message;
  node.dataset.kind = kind;
}

export async function confirmAction(root: HTMLElement, title: string, message: string, label: string, run: () => Promise<void>): Promise<void> {
  const dialog = createInsightDialog({ title, bodyHtml: `<p>${escapeHtml(message)}</p>`, submitLabel: label, mountTarget: root });
  const finish = async () => { await dialog.close(); dialog.dispose(); };
  dialog.bindChrome(() => { void finish(); });
  dialog.panel.addEventListener("submit", (event) => {
    event.preventDefault();
    if (dialog.busy) return;
    dialog.setBusy(true);
    void run().then(finish).catch((error) => dialog.setError(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (!dialog.busy) return; dialog.setBusy(false); });
  });
  await dialog.open();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function section(title: string, description = ""): HTMLElement {
  const root = el("section", "finance-v2-section");
  root.append(el("h2", "finance-v2-section-title", title));
  if (description) root.append(el("p", "finance-v2-section-description", description));
  return root;
}

export function textField(label: string, value = "", multiline = false): { root: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const root = el("label", "finance-v2-field");
  root.append(el("span", "finance-v2-field-label", label));
  const input = multiline ? el("textarea") : el("input");
  input.value = value;
  root.append(input);
  return { root, input };
}

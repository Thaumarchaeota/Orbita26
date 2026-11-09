import { mountActionTracksView } from "../admin/timeline/action-tracks-view";
import { productivityCommitItemWithActions } from "./client";
import { invokeErrorText, isRevisionConflict } from "../admin/tabs/item-compose";
import "../admin/tabs/item-compose.css";

const TASK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type ActionDraft = { localId: string; title: string };

export function mountProductivityPanel(shellBody: HTMLElement, _dialogRoot: HTMLElement): void {
  const aside = shellBody.querySelector<HTMLElement>(".shell-aside");
  if (!aside) return;

  const ac = new AbortController();
  const section = document.createElement("section");
  section.className = "ticktick-section productivity-panel-section";
  section.innerHTML = `
    <div class="launcher-head">
      <span class="launcher-title">${TASK_SVG}任务</span>
    </div>
    <div class="productivity-panel-timeline" data-region="timeline"></div>
    <div class="productivity-panel-compose" data-region="compose">
      <input type="text" placeholder="Inbox 新任务" data-region="item-title" autocomplete="off">
      <div data-region="draft-actions"></div>
      <div class="ticktick-todo-actions">
        <button type="button" class="ticktick-icon-btn" data-action="add-action" data-tip="添加安排">${PLUS_SVG}</button>
        <button type="button" class="dialog-btn dialog-btn-primary" data-action="commit">保存</button>
      </div>
      <p class="item-compose-error" data-region="error" hidden></p>
    </div>`;
  aside.appendChild(section);

  const timelineHost = section.querySelector<HTMLElement>('[data-region="timeline"]')!;
  const titleInput = section.querySelector<HTMLInputElement>('[data-region="item-title"]')!;
  const draftsEl = section.querySelector<HTMLElement>('[data-region="draft-actions"]')!;
  const errorEl = section.querySelector<HTMLElement>('[data-region="error"]')!;
  const tracks = mountActionTracksView(timelineHost, { signal: ac.signal, readOnly: true });
  void tracks.activate();

  let drafts: ActionDraft[] = [];
  let nextLocal = 1;

  function setError(msg: string): void {
    errorEl.hidden = !msg;
    errorEl.textContent = msg;
  }

  function renderDrafts(): void {
    draftsEl.innerHTML = drafts
      .map(
        (d) => `
      <div class="item-compose-action-row" data-local-id="${escapeHtml(d.localId)}">
        <div class="item-compose-action-head">
          <input type="text" value="${escapeHtml(d.title)}" data-field="title">
          <button type="button" class="dialog-btn" data-action="remove">删除</button>
        </div>
      </div>`,
      )
      .join("");
  }

  section.querySelector<HTMLButtonElement>('[data-action="add-action"]')?.addEventListener("click", () => {
    drafts.push({ localId: `d-${nextLocal++}`, title: titleInput.value.trim() || "安排" });
    renderDrafts();
  });

  draftsEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="remove"]');
    if (!btn) return;
    const row = btn.closest<HTMLElement>(".item-compose-action-row");
    const id = row?.dataset.localId;
    if (!id) return;
    drafts = drafts.filter((d) => d.localId !== id);
    renderDrafts();
  });

  timelineHost.addEventListener("dblclick", () => {
    alert("请在 Insight 中打开 Project / Task / Session");
  });

  section.querySelector<HTMLButtonElement>('[data-action="commit"]')?.addEventListener("click", () => {
    void (async () => {
      const title = titleInput.value.trim();
      if (!title) return;
      for (const row of draftsEl.querySelectorAll<HTMLElement>(".item-compose-action-row")) {
        const id = row.dataset.localId!;
        const d = drafts.find((x) => x.localId === id);
        const input = row.querySelector<HTMLInputElement>('[data-field="title"]');
        if (d && input) d.title = input.value.trim() || d.title;
      }
      try {
        await productivityCommitItemWithActions({
          itemCreate: { title, status: "进行中", listId: null, priority: "none" },
          expectedAssociatedActions: [],
          actionCreates: drafts.filter((d) => d.title.trim()).map((d) => ({ title: d.title.trim() })),
          actionUpdates: [],
          actionDeletes: [],
        });
        titleInput.value = "";
        drafts = [];
        renderDrafts();
        setError("");
        void tracks.activate();
      } catch (err) {
        if (isRevisionConflict(err)) setError("任务内容已变化");
        else setError(invokeErrorText(err));
      }
    })();
  });
}

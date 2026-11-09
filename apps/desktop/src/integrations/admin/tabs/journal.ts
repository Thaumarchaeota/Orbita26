import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../../ui/time-picker";
import { completeChat } from "../../ai/adapter";
import { getActiveEntry, loadAiConfig } from "../../ai/config";
import { renderMarkdown } from "../../ai/render-markdown";
import {
  journalArchiveConvertNoteToDocument,
  journalArchiveCreateDocument,
  journalArchiveCreateNote,
  journalArchiveGetEntry,
  journalArchiveSaveDocument,
  journalArchiveUpdateNote,
  journalTabTitle,
  parseJournalTabId,
  utcNowIso,
  type JournalEntrySnapshot,
} from "../../journal/archive-client";
import { setDirtyStatus } from "../tab-host/dirty";
import type { InsightDestination, InsightDestinationHandle } from "../types";

type JournalState = { entryId?: string };

type DraftKind = "note" | "document";

const AUTOSAVE_MS = 800;

const ARROW_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`;

const JOURNAL_AI_SYSTEM = `你是随记/文档表单助手。根据用户指令改写当前草稿，只输出一个 JSON 对象，不要 markdown，不要解释。

输出格式：
{"title":"","text":"","summary":"","mood":""}

规则：
- user 消息含当前表单 JSON。可改字段：title、text、summary、mood（均为字符串）。
- 用户没要求改的字段保持草稿原值，不要省略键或改成 null。
- text 是正文（文档为 Markdown）。
- 不要调用任何工具，不要声称已保存。`;

function parseAiJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(text);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function entryKind(entry: JournalEntrySnapshot | null, fallback: DraftKind): DraftKind {
  if (entry?.kind === "document") return "document";
  if (entry?.kind === "note") return "note";
  return fallback;
}

function syncTabTitle(surfaceKey: string, kind: DraftKind, title: string, text: string): void {
  window.dispatchEvent(
    new CustomEvent("orbita:insight-tab-title", {
      detail: { surfaceKey, title: journalTabTitle(kind, title, text) },
    }),
  );
}

function notifyEntryCreated(draftId: string, entry: JournalEntrySnapshot): void {
  window.dispatchEvent(
    new CustomEvent("orbita:journal-entry-created", {
      detail: {
        draftId,
        entryId: entry.id,
        title: journalTabTitle(
          entry.kind === "document" ? "document" : "note",
          entry.title ?? "",
          entry.text ?? entry.markdown ?? "",
        ),
      },
    }),
  );
}

export const journalDestination: InsightDestination = {
  id: "journal",
  kind: "domain",
  label: "随记",
  icon: "journal",
  showInNav: false,
  mount(root) {
    let entryId: string | null = null;
    let entry: JournalEntrySnapshot | null = null;
    let draftKind: DraftKind = "note";
    let loaded = false;
    let disposed = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let saveSeq = 0;

    let title = "";
    let text = "";
    let summary = "";
    let mood = "";
    let startedAt = utcNowIso();
    let showPreview = false;
    let aiBusy = false;

    let savedTitle = "";
    let savedText = "";
    let savedSummary = "";
    let savedMood = "";
    let savedStartedAt = startedAt;

    root.innerHTML = `
      <style>
        .journal-entry-page { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 20px 24px; box-sizing: border-box; gap: 12px; }
        .journal-entry-deleted { margin: 0; color: var(--insight-text-disabled, #9ca3af); font-size: 14px; }
        .journal-entry-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .journal-entry-title { flex: 1 1 200px; min-width: 0; padding: 8px 10px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; font-size: 16px; }
        .journal-entry-title:disabled { background: var(--insight-surface-sunken, #f9fafb); color: var(--insight-text-disabled, #9ca3af); }
        .journal-entry-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .journal-entry-btn { padding: 6px 12px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; background: var(--insight-surface-panel, #fff); cursor: pointer; font-size: 13px; }
        .journal-entry-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .journal-entry-btn-primary { background: var(--insight-primary, #111827); color: #fff; border-color: var(--insight-primary, #111827); }
        .journal-entry-status { font-size: 13px; color: var(--insight-text-secondary, #6b7280); min-width: 4em; }
        .journal-entry-status.is-ok { color: #059669; }
        .journal-entry-status.is-err { color: #dc2626; }
        .journal-entry-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .journal-entry-meta input { padding: 6px 10px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; font-size: 13px; }
        .journal-entry-meta input:disabled { background: var(--insight-surface-sunken, #f9fafb); color: var(--insight-text-disabled, #9ca3af); }
        .journal-entry-started { display: flex; gap: 8px; align-items: center; }
        .journal-entry-started.is-disabled { pointer-events: none; opacity: 0.5; }
        .journal-entry-body { display: flex; flex: 1; min-height: 0; gap: 12px; }
        .journal-entry-editor { flex: 1; min-width: 0; min-height: 200px; padding: 12px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; font-size: 14px; line-height: 1.5; resize: none; font-family: inherit; }
        .journal-entry-editor:disabled { background: var(--insight-surface-sunken, #f9fafb); color: var(--insight-text-secondary, #6b7280); }
        .journal-entry-preview { flex: 1; min-width: 0; min-height: 200px; padding: 12px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; overflow: auto; font-size: 14px; line-height: 1.6; background: var(--insight-surface-panel, #fafafa); }
        .journal-entry-preview[hidden] { display: none !important; }
        .journal-entry-editor[hidden] { display: none !important; }
        .journal-entry-page.is-readonly .journal-entry-btn:not([data-region="preview-toggle"]) { display: none; }
        .journal-entry-ai { display: flex; gap: 8px; align-items: center; }
        .journal-entry-ai[hidden] { display: none !important; }
        .journal-entry-ai-input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--insight-border-subtle, #e5e7eb); border-radius: 8px; font-size: 13px; }
        .journal-entry-ai-input:disabled { background: var(--insight-surface-sunken, #f9fafb); color: var(--insight-text-disabled, #9ca3af); }
        .journal-entry-ai-send { padding: 6px 10px; min-width: 36px; }
      </style>
      <div class="journal-entry-page" data-region="page">
        <p class="journal-entry-deleted admin-placeholder-hint" data-region="deleted" hidden>已删除</p>
        <div class="journal-entry-toolbar">
          <input type="text" class="journal-entry-title" data-region="title" placeholder="标题" autocomplete="off">
          <div class="journal-entry-actions">
            <button type="button" class="journal-entry-btn" data-region="preview-toggle" hidden>预览</button>
            <button type="button" class="journal-entry-btn journal-entry-btn-primary" data-region="save" hidden>保存</button>
            <button type="button" class="journal-entry-btn" data-region="convert" hidden>转为文档</button>
            <span class="journal-entry-status" data-region="status"></span>
          </div>
        </div>
        <div class="journal-entry-meta">
          <input type="text" data-region="mood" placeholder="心情" autocomplete="off">
          <div class="journal-entry-started" data-region="started-wrap">
            <div data-region="started-date"></div>
            <div data-region="started-time"></div>
          </div>
        </div>
        <div class="journal-entry-ai" data-region="ai-bar">
          <input type="text" class="journal-entry-ai-input" data-region="ai-input" placeholder="用自然语言描述…" autocomplete="off">
          <button type="button" class="journal-entry-btn journal-entry-ai-send" data-region="ai-send" aria-label="生成">${ARROW_SVG}</button>
        </div>
        <div class="journal-entry-body">
          <textarea class="journal-entry-editor" data-region="editor" placeholder="正文"></textarea>
          <div class="journal-entry-preview scroll-slim" data-region="preview" hidden></div>
        </div>
      </div>`;

    const pageEl = root.querySelector<HTMLElement>('[data-region="page"]')!;
    const deletedEl = root.querySelector<HTMLElement>('[data-region="deleted"]')!;
    const titleInput = root.querySelector<HTMLInputElement>('[data-region="title"]')!;
    const moodInput = root.querySelector<HTMLInputElement>('[data-region="mood"]')!;
    const startedWrap = root.querySelector<HTMLElement>('[data-region="started-wrap"]')!;
    const editor = root.querySelector<HTMLTextAreaElement>('[data-region="editor"]')!;
    const previewEl = root.querySelector<HTMLElement>('[data-region="preview"]')!;
    const saveBtn = root.querySelector<HTMLButtonElement>('[data-region="save"]')!;
    const convertBtn = root.querySelector<HTMLButtonElement>('[data-region="convert"]')!;
    const previewToggle = root.querySelector<HTMLButtonElement>('[data-region="preview-toggle"]')!;
    const statusEl = root.querySelector<HTMLElement>('[data-region="status"]')!;
    const aiBar = root.querySelector<HTMLElement>('[data-region="ai-bar"]')!;
    const aiInput = root.querySelector<HTMLInputElement>('[data-region="ai-input"]')!;
    const aiSendBtn = root.querySelector<HTMLButtonElement>('[data-region="ai-send"]')!;

    function surfaceKey(): string | null {
      return root.dataset.surface ?? null;
    }

    function kind(): DraftKind {
      return entryKind(entry, draftKind);
    }

    function isDeleted(): boolean {
      return !!entry?.deletedAt;
    }

    function isDraft(): boolean {
      return entryId ? parseJournalTabId(entryId).isDraft : true;
    }

    function isReadonly(): boolean {
      return isDeleted();
    }

    function toDatetimeLocal(iso: string): string {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function fromDatetimeLocal(v: string): string {
      if (!v) return startedAt;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? startedAt : d.toISOString().replace(/\.\d{3}Z$/, "Z");
    }

    function isoToStartedParts(iso: string): { date: string; time: string } {
      const local = toDatetimeLocal(iso);
      if (!local) return { date: "", time: "" };
      const i = local.indexOf("T");
      if (i < 0) return { date: local, time: "" };
      return { date: local.slice(0, i), time: local.slice(i + 1) };
    }

    function startedPartsToIso(date: string, time: string): string {
      const t = normalizeHhMm(time) || time;
      if (!date || !t) return fromDatetimeLocal("");
      return fromDatetimeLocal(`${date}T${t}`);
    }

    const onStartedChange = () => {
      readForm();
      setStatus("");
      if (kind() === "document") scheduleDocumentSave();
      else syncDirty();
    };
    const startedParts = isoToStartedParts(startedAt);
    const startedDatePicker = mountDecoupledDatePicker({ defaultTrigger: { container: root.querySelector("[data-region=started-date]")! },
      value: startedParts.date,
      onChange: onStartedChange,
    });
    const startedTimePicker = mountDecoupledTimePicker({ defaultTrigger: { container: root.querySelector("[data-region=started-time]")! },
      value: normalizeHhMm(startedParts.time),
      onChange: onStartedChange,
    });

    function readForm(): void {
      title = titleInput.value;
      text = editor.value;
      mood = moodInput.value;
      startedAt = startedPartsToIso(startedDatePicker.getValue(), startedTimePicker.getValue());
    }

    function writeForm(): void {
      titleInput.value = title;
      editor.value = text;
      moodInput.value = mood;
      const parts = isoToStartedParts(startedAt);
      startedDatePicker.setValue(parts.date);
      startedTimePicker.setValue(normalizeHhMm(parts.time));
      if (showPreview) {
        previewEl.innerHTML = renderMarkdown(text);
      }
    }

    function captureSaved(): void {
      savedTitle = title;
      savedText = text;
      savedSummary = summary;
      savedMood = mood;
      savedStartedAt = startedAt;
    }

    function hasUnsavedChanges(): boolean {
      return (
        title !== savedTitle ||
        text !== savedText ||
        summary !== savedSummary ||
        mood !== savedMood ||
        startedAt !== savedStartedAt
      );
    }

    function syncDirty(inFlight = false, failed = false): void {
      const key = surfaceKey();
      if (!key || isReadonly()) {
        if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        return;
      }
      const dirty = hasUnsavedChanges() || isDraft();
      setDirtyStatus(key, { dirty, inFlight, failed });
    }

    function setStatus(msg: string, tone: "" | "ok" | "err" = ""): void {
      statusEl.textContent = msg;
      statusEl.className = "journal-entry-status";
      if (tone === "ok") statusEl.classList.add("is-ok");
      if (tone === "err") statusEl.classList.add("is-err");
    }

    function applyEntry(snap: JournalEntrySnapshot): void {
      entry = snap;
      entryId = snap.id;
      title = snap.title ?? "";
      text = snap.kind === "document" ? snap.markdown ?? "" : snap.text ?? "";
      summary = snap.summary ?? "";
      mood = snap.mood ?? "";
      startedAt = snap.startedAt;
      draftKind = snap.kind === "document" ? "document" : "note";
      captureSaved();
      writeForm();
      updateChrome();
      syncDirty();
    }

    function updateChrome(): void {
      const k = kind();
      const readonly = isReadonly();
      pageEl.classList.toggle("is-readonly", readonly);
      deletedEl.textContent = "已删除";
      deletedEl.hidden = !readonly;

      titleInput.disabled = readonly;
      moodInput.disabled = readonly;
      startedWrap.classList.toggle("is-disabled", readonly);
      editor.disabled = readonly;

      titleInput.placeholder = k === "document" ? "标题（必填）" : "标题（可选）";
      editor.placeholder = k === "document" ? "Markdown 正文" : "正文（必填）";

      saveBtn.hidden = k !== "note" || readonly;
      convertBtn.hidden = k !== "note" || readonly || isDraft() || !entry;
      previewToggle.hidden = k !== "document" || readonly;
      previewToggle.textContent = showPreview ? "编辑" : "预览";

      if (k === "document") {
        editor.hidden = showPreview;
        previewEl.hidden = !showPreview;
        if (showPreview) previewEl.innerHTML = renderMarkdown(text);
      } else {
        editor.hidden = false;
        previewEl.hidden = true;
      }

      aiBar.hidden = readonly;
      aiInput.disabled = readonly || aiBusy;
      aiSendBtn.disabled = readonly || aiBusy;
    }

    function draftJson(): string {
      const draft: Record<string, string> = {
        title: titleInput.value,
        text: editor.value,
        mood: moodInput.value,
      };
      if (summary) draft.summary = summary;
      return JSON.stringify(draft);
    }

    function applyAiResult(data: Record<string, unknown>): void {
      const toInput: HTMLElement[] = [];
      let summaryFromAi: string | null = null;

      if (typeof data.title === "string") {
        titleInput.value = data.title;
        toInput.push(titleInput);
      }
      if (typeof data.text === "string") {
        editor.value = data.text;
        toInput.push(editor);
      }
      if (typeof data.mood === "string") {
        moodInput.value = data.mood;
        toInput.push(moodInput);
      }
      if (typeof data.summary === "string") {
        summaryFromAi = data.summary;
      }

      for (const el of toInput) {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (summaryFromAi !== null && kind() === "document") {
        summary = summaryFromAi;
        scheduleDocumentSave();
      }
    }

    async function runAi(): Promise<void> {
      const prompt = aiInput.value.trim();
      if (!prompt || aiBusy || isReadonly()) return;
      aiBusy = true;
      aiInput.disabled = true;
      aiSendBtn.disabled = true;
      setStatus("");

      try {
        const config = await loadAiConfig();
        const entry = getActiveEntry(config);
        if (!entry) {
          setStatus("请先在 AI 设置中添加 API", "err");
          return;
        }
        if (!entry.apiKey.trim()) {
          setStatus("请先在设置中填写 API Key", "err");
          return;
        }
        const raw = await completeChat(
          JOURNAL_AI_SYSTEM,
          draftJson() + "\n\n用户：" + prompt,
          entry,
          config.activeModel,
        );
        aiInput.value = "";
        const parsed = parseAiJson(raw);
        if (!parsed) {
          setStatus("AI 返回格式无法解析", "err");
          return;
        }
        applyAiResult(parsed);
      } catch (e) {
        setStatus(String(e), "err");
      } finally {
        aiBusy = false;
        if (!isReadonly()) {
          aiInput.disabled = false;
          aiSendBtn.disabled = false;
        }
      }
    }

    function clearDebounce(): void {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }

    async function loadEntry(): Promise<void> {
      if (!entryId || isDraft()) {
        loaded = true;
        updateChrome();
        syncDirty();
        return;
      }
      try {
        const res = await journalArchiveGetEntry(entryId);
        if (disposed) return;
        applyEntry(res.entry);
        loaded = true;
      } catch {
        if (disposed) return;
        deletedEl.textContent = "无法加载此记录";
        deletedEl.hidden = false;
        pageEl.classList.add("is-readonly");
        titleInput.disabled = true;
        moodInput.disabled = true;
        startedWrap.classList.add("is-disabled");
        editor.disabled = true;
        saveBtn.hidden = true;
        convertBtn.hidden = true;
        previewToggle.hidden = true;
        aiBar.hidden = true;
        const key = surfaceKey();
        if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        loaded = true;
      }
    }

    async function saveNote(): Promise<void> {
      readForm();
      if (!text.trim()) {
        setStatus("正文不能为空", "err");
        return;
      }
      const key = surfaceKey();
      if (!key) return;
      const seq = ++saveSeq;
      setStatus("");
      syncDirty(true, false);

      try {
        if (isDraft() || !entry) {
          const draftId = entryId!;
          const res = await journalArchiveCreateNote({
            startedAt,
            text: text.trim(),
            title: title.trim() || undefined,
            mood: mood.trim() || undefined,
          });
          if (disposed || seq !== saveSeq) return;
          applyEntry(res.entry);
          notifyEntryCreated(draftId, res.entry);
          setStatus("已保存", "ok");
          syncDirty(false, false);
          syncTabTitle(key, "note", title, text);
          return;
        }

        const res = await journalArchiveUpdateNote({
          id: entry.id,
          expectedRevision: entry.revision,
          text: text.trim(),
          title: title.trim() || null,
          startedAt,
          mood: mood.trim() || null,
        });
        if (disposed || seq !== saveSeq) return;
        applyEntry(res.entry);
        setStatus("已保存", "ok");
        syncDirty(false, false);
        syncTabTitle(key, "note", title, text);
      } catch (e) {
        if (disposed || seq !== saveSeq) return;
        setStatus(String(e), "err");
        syncDirty(false, true);
      }
    }

    async function saveDocument(): Promise<void> {
      readForm();
      const titleTrim = title.trim();
      if (!titleTrim) {
        setStatus("标题必填", "err");
        return;
      }

      const key = surfaceKey();
      if (!key) return;
      const seq = ++saveSeq;
      setStatus("");
      syncDirty(true, false);

      try {
        if (isDraft() || !entry) {
          const draftId = entryId!;
          const res = await journalArchiveCreateDocument({
            title: titleTrim,
            startedAt,
            markdown: text,
            summary: summary.trim() || undefined,
            mood: mood.trim() || undefined,
          });
          if (disposed || seq !== saveSeq) return;
          applyEntry(res.entry);
          notifyEntryCreated(draftId, res.entry);
          setStatus("已保存", "ok");
          syncDirty(false, false);
          syncTabTitle(key, "document", title, text);
          return;
        }

        const res = await journalArchiveSaveDocument({
          id: entry.id,
          expectedRevision: entry.revision,
          title: titleTrim,
          markdown: text,
          startedAt,
          summary: summary.trim() || null,
          mood: mood.trim() || null,
        });
        if (disposed || seq !== saveSeq) return;
        applyEntry(res.entry);
        setStatus("已保存", "ok");
        syncDirty(false, false);
        syncTabTitle(key, "document", title, text);
      } catch (e) {
        if (disposed || seq !== saveSeq) return;
        setStatus(String(e), "err");
        syncDirty(false, true);
      }
    }

    function scheduleDocumentSave(): void {
      if (isReadonly() || kind() !== "document") return;
      readForm();
      if (!title.trim()) {
        setStatus("标题必填", "err");
        syncDirty();
        return;
      }
      clearDebounce();
      setStatus("");
      syncDirty();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void saveDocument();
      }, AUTOSAVE_MS);
    }

    async function convertToDocument(): Promise<void> {
      readForm();
      const titleTrim = title.trim();
      if (!titleTrim) {
        setStatus("请先填写标题", "err");
        titleInput.focus();
        return;
      }
      if (!entry || isDraft()) return;

      const key = surfaceKey();
      if (!key) return;
      const seq = ++saveSeq;
      setStatus("");
      syncDirty(true, false);

      try {
        const res = await journalArchiveConvertNoteToDocument({
          id: entry.id,
          expectedRevision: entry.revision,
          title: titleTrim,
          mood: mood.trim() || null,
        });
        if (disposed || seq !== saveSeq) return;
        applyEntry(res.entry);
        showPreview = false;
        setStatus("已转为文档", "ok");
        syncDirty(false, false);
        syncTabTitle(key, "document", title, text);
      } catch (e) {
        if (disposed || seq !== saveSeq) return;
        setStatus(String(e), "err");
        syncDirty(false, true);
      }
    }

    titleInput.addEventListener("input", () => {
      readForm();
      setStatus("");
      if (kind() === "document") scheduleDocumentSave();
      else syncDirty();
      syncTabTitle(surfaceKey() ?? "", kind(), title, text);
    });

    moodInput.addEventListener("input", () => {
      readForm();
      setStatus("");
      if (kind() === "document") scheduleDocumentSave();
      else syncDirty();
    });

    editor.addEventListener("input", () => {
      readForm();
      setStatus("");
      if (kind() === "document") {
        if (showPreview) previewEl.innerHTML = renderMarkdown(text);
        scheduleDocumentSave();
      } else {
        syncDirty();
      }
    });

    saveBtn.addEventListener("click", () => void saveNote());
    convertBtn.addEventListener("click", () => void convertToDocument());
    previewToggle.addEventListener("click", () => {
      showPreview = !showPreview;
      updateChrome();
    });

    aiSendBtn.addEventListener("click", () => void runAi());
    aiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void runAi();
      }
    });

    const handle: InsightDestinationHandle = {
      activate() {
        if (!loaded) return loadEntry();
        updateChrome();
      },
      deactivate() {
        clearDebounce();
      },
      getRestoreState() {
        return entryId ? { entryId } : undefined;
      },
      restoreState(state: unknown) {
        const s = state as JournalState;
        entryId = s?.entryId ?? null;
        entry = null;
        draftKind = "note";
        title = "";
        text = "";
        summary = "";
        mood = "";
        if (entryId) {
          const parsed = parseJournalTabId(entryId);
          if (parsed.kind) draftKind = parsed.kind;
        }
        startedAt = utcNowIso();
        savedTitle = "";
        savedText = "";
        savedSummary = "";
        savedMood = "";
        savedStartedAt = startedAt;
        showPreview = false;
        writeForm();
        setStatus("");
        updateChrome();
        loaded = false;
      },
      dispose() {
        disposed = true;
        clearDebounce();
        const key = surfaceKey();
        if (key) setDirtyStatus(key, { dirty: false, inFlight: false, failed: false });
        startedDatePicker.dispose();
        startedTimePicker.dispose();
        root.innerHTML = "";
      },
    };

    return handle;
  },
};

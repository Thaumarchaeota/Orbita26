import { mountDecoupledDatePicker } from "../../../ui/decoupled-date-picker";
import { mountDecoupledTimePicker } from "../../../ui/decoupled-time-picker";
import { normalizeHhMm } from "../../../ui/time-picker";
import { bindBackdropPressDismiss } from "../../../ui/backdrop-dismiss";
import { bindDialog } from "../../../ui/motion";
import { showCommandMenuAt } from "../../../ui/command-menu-popover";
import {
  journalArchiveCreateDocument,
  journalArchiveCreateNote,
  journalArchiveGetEntry,
  journalArchiveListEntries,
  journalArchiveSaveDocument,
  journalArchiveUpdateNote,
  journalTabTitle,
  type JournalEntrySnapshot,
} from "../../journal/archive-client";
import { beijingToday, defaultTrackWindow } from "../tabs/health/format";
import type { TimelineClock } from "./sources";

const PAD_LEFT = 70;
const PAD_RIGHT = 4;
const CLUSTER_PX = 18;
const AUTOSAVE_MS = 800;

const NOTE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>`;
const DOC_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;

export type JournalTracksViewHandle = {
  activate: () => void | Promise<void>;
  deactivate: () => void;
  dispose: () => void;
};

type JournalTracksViewOpts = {
  signal: AbortSignal;
  clock?: TimelineClock;
};

type JournalSide = "note" | "document";

type PlacedEntry = {
  entry: JournalEntrySnapshot;
  side: JournalSide;
  startedUtc: number;
  x: number;
};

type MarkerCluster = {
  side: JournalSide;
  x: number;
  entries: JournalEntrySnapshot[];
};

function plotInnerWidth(w: number): number {
  return Math.max(1, w - PAD_LEFT - PAD_RIGHT);
}

function xForTime(t: number, fromUtc: number, toUtc: number, w: number): number {
  return PAD_LEFT + ((t - fromUtc) / (toUtc - fromUtc)) * plotInnerWidth(w);
}

function timeAtPlotXClamped(x: number, fromUtc: number, toUtc: number, w: number): number {
  const innerW = plotInnerWidth(w);
  const local = Math.max(0, Math.min(innerW, x - PAD_LEFT));
  return fromUtc + (local / innerW) * (toUtc - fromUtc);
}

function parseStartedAtUtc(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function utcToIso(ts: number): string {
  return new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function invokeErrorText(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : JSON.stringify(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch {
    /* not json */
  }
  return raw;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(v: string): string {
  if (!v) return utcToIso(Math.floor(Date.now() / 1000));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? utcToIso(Math.floor(Date.now() / 1000)) : d.toISOString().replace(/\.\d{3}Z$/, "Z");
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

function entrySide(entry: JournalEntrySnapshot): JournalSide {
  return entry.kind === "document" ? "document" : "note";
}

function entryLabel(entry: JournalEntrySnapshot): string {
  const title = entry.title?.trim();
  if (title) return title;
  if (entry.kind === "note") {
    const line = (entry.text ?? "").trim().split(/\r?\n/)[0]?.trim();
    if (line) return line.length > 40 ? `${line.slice(0, 40)}…` : line;
    return "随记";
  }
  return "文档";
}

function clusterMarkers(placed: PlacedEntry[]): MarkerCluster[] {
  const bySide: Record<JournalSide, PlacedEntry[]> = { note: [], document: [] };
  for (const p of placed) bySide[p.side].push(p);
  const out: MarkerCluster[] = [];
  for (const side of ["note", "document"] as JournalSide[]) {
    const sorted = [...bySide[side]].sort((a, b) => a.x - b.x);
    let group: PlacedEntry[] = [];
    for (const item of sorted) {
      if (!group.length || item.x - group[group.length - 1].x < CLUSTER_PX) {
        group.push(item);
      } else {
        out.push({
          side,
          x: group.reduce((s, g) => s + g.x, 0) / group.length,
          entries: group.map((g) => g.entry),
        });
        group = [item];
      }
    }
    if (group.length) {
      out.push({
        side,
        x: group.reduce((s, g) => s + g.x, 0) / group.length,
        entries: group.map((g) => g.entry),
      });
    }
  }
  return out;
}

export function mountJournalTracksView(
  root: HTMLElement,
  opts: JournalTracksViewOpts,
): JournalTracksViewHandle {
  const signal = opts.signal;
  const clock = opts.clock;
  const initialClock = clock?.get();
  let selectedDate = initialClock?.selectedDate ?? beijingToday();
  let fromUtc = initialClock?.fromUtc ?? 0;
  let toUtc = initialClock?.toUtc ?? 0;
  let entries: JournalEntrySnapshot[] = [];
  let listFailed = false;
  let loading = false;
  let applyingClock = false;

  function applyClock(next: { fromUtc: number; toUtc: number; selectedDate: string }): void {
    if (fromUtc === next.fromUtc && toUtc === next.toUtc && selectedDate === next.selectedDate) {
      return;
    }
    const dateChanged = selectedDate !== next.selectedDate;
    applyingClock = true;
    fromUtc = next.fromUtc;
    toUtc = next.toUtc;
    selectedDate = next.selectedDate;
    if (dateChanged) void reload();
    else paint();
    applyingClock = false;
  }

  root.className = "health-track-card journal-track-card";
  root.innerHTML = `
    <div class="health-track-card-legend health-track-legend-col">
      <div class="orbita-swatch-toggle-grid">
        <div class="orbita-swatch-toggle-cell is-on">
          <span class="orbita-swatch-toggle-icon journal-track-legend-icon">${NOTE_ICON}</span>
          <span class="orbita-swatch-toggle-label">随记</span>
        </div>
      </div>
    </div>
    <div class="health-track-card-plot">
      <div class="journal-track-lanes" data-region="lanes">
        <div class="journal-track-axis" data-region="axis" hidden></div>
        <div class="journal-track-markers" data-region="markers"></div>
        <p class="journal-track-error" data-region="error" hidden></p>
      </div>
    </div>`;

  const lanesEl = root.querySelector<HTMLElement>('[data-region="lanes"]')!;
  const axisEl = root.querySelector<HTMLElement>('[data-region="axis"]')!;
  const markersEl = root.querySelector<HTMLElement>('[data-region="markers"]')!;
  const errorEl = root.querySelector<HTMLElement>('[data-region="error"]')!;

  function setError(msg: string): void {
    if (msg) {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
  }

  function visibleEntries(): JournalEntrySnapshot[] {
    return entries.filter((e) => {
      const t = parseStartedAtUtc(e.startedAt);
      return t >= fromUtc && t <= toUtc;
    });
  }

  function placeEntries(plotW: number): PlacedEntry[] {
    return visibleEntries().map((entry) => {
      const startedUtc = parseStartedAtUtc(entry.startedAt);
      return {
        entry,
        side: entrySide(entry),
        startedUtc,
        x: xForTime(startedUtc, fromUtc, toUtc, plotW),
      };
    });
  }

  function paint(): void {
    const plotW = lanesEl.clientWidth;
    if (listFailed) {
      axisEl.hidden = true;
      markersEl.replaceChildren();
      return;
    }
    axisEl.hidden = false;
    markersEl.replaceChildren();
    const clusters = clusterMarkers(placeEntries(plotW));
    for (const cluster of clusters) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `journal-track-marker is-${cluster.side}`;
      if (cluster.entries.length > 1) el.classList.add("is-cluster");
      el.style.left = `${cluster.x}px`;
      el.dataset.side = cluster.side;
      if (cluster.entries.length === 1) {
        el.dataset.entryId = cluster.entries[0].id;
        el.title = entryLabel(cluster.entries[0]);
        el.innerHTML =
          cluster.side === "note"
            ? `<span class="journal-track-marker-icon">${NOTE_ICON}</span>`
            : `<span class="journal-track-marker-icon">${DOC_ICON}</span>`;
      } else {
        el.title = `${cluster.entries.length} 条记录`;
        el.innerHTML = `<span class="journal-track-marker-count">${cluster.entries.length}</span>`;
      }
      markersEl.appendChild(el);
    }
  }

  async function reload(): Promise<void> {
    if (loading) return;
    loading = true;
    listFailed = false;
    root.classList.add("is-loading");
    try {
      const res = await journalArchiveListEntries();
      entries = res.entries.filter(
        (e) => !e.deletedAt && (e.kind === "note" || e.kind === "document"),
      );
      setError("");
    } catch (err) {
      entries = [];
      listFailed = true;
      setError(`无法加载随记：${invokeErrorText(err)}`);
    } finally {
      loading = false;
      root.classList.remove("is-loading");
      paint();
    }
  }

  function bindDialogEscape(close: () => void): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }

  function openEditor(opts: {
    kind: JournalSide;
    mode: "create" | "edit";
    startedAt: string;
    entry?: JournalEntrySnapshot;
  }): void {
    const isNote = opts.kind === "note";
    let isDraft = opts.mode === "create";
    let entry = opts.entry ?? null;
    let title = entry?.title ?? "";
    let text = isNote ? entry?.text ?? "" : entry?.markdown ?? "";
    let mood = entry?.mood ?? "";
    let startedAt = entry?.startedAt ?? opts.startedAt;
    let saveSeq = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop motion-dialog journal-track-editor-backdrop";
    backdrop.innerHTML = `
      <form class="dialog-panel motion-dialog-panel journal-track-editor-panel">
        <div class="dialog-title" data-region="title">${isDraft ? (isNote ? "新建随记" : "新建文档") : isNote ? "编辑随记" : "编辑文档"}</div>
        <div class="dialog-field">
          <label>${isNote ? "标题（可选）" : "标题"}</label>
          <input type="text" id="journalEditorTitle" value="${escapeAttr(title)}" autocomplete="off">
        </div>
        <div class="dialog-field">
          <label>时间</label>
          <div style="display:flex;gap:8px;align-items:center">
            <div data-region="started-date"></div>
            <div data-region="started-time"></div>
          </div>
        </div>
        <div class="dialog-field">
          <label>心情（可选）</label>
          <input type="text" id="journalEditorMood" value="${escapeAttr(mood)}" autocomplete="off">
        </div>
        <div class="dialog-field">
          <label>${isNote ? "正文" : "Markdown"}</label>
          <textarea id="journalEditorBody" rows="${isNote ? 6 : 12}" placeholder="${isNote ? "正文（必填）" : "Markdown 正文"}">${escapeHtml(text)}</textarea>
        </div>
        <p class="journal-track-editor-error" data-region="form-error" hidden></p>
        <p class="journal-track-editor-status" data-region="status"></p>
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" data-action="cancel">取消</button>
          ${isNote ? '<button type="submit" class="dialog-btn dialog-btn-primary">保存</button>' : ""}
        </div>
      </form>`;

    document.body.appendChild(backdrop);
    const titleInput = backdrop.querySelector<HTMLInputElement>("#journalEditorTitle")!;
    const moodInput = backdrop.querySelector<HTMLInputElement>("#journalEditorMood")!;
    const bodyInput = backdrop.querySelector<HTMLTextAreaElement>("#journalEditorBody")!;
    const formError = backdrop.querySelector<HTMLElement>('[data-region="form-error"]')!;
    const statusEl = backdrop.querySelector<HTMLElement>('[data-region="status"]')!;

    const onStartedChange = () => {
      setFormError("");
      if (!isNote) scheduleDocumentSave();
    };
    const parts = isoToStartedParts(startedAt);
    const startedDatePicker = mountDecoupledDatePicker({ defaultTrigger: { container: backdrop.querySelector("[data-region=started-date]")! },
      value: parts.date,
      onChange: onStartedChange,
    });
    const startedTimePicker = mountDecoupledTimePicker({ defaultTrigger: { container: backdrop.querySelector("[data-region=started-time]")! },
      value: normalizeHhMm(parts.time),
      onChange: onStartedChange,
    });

    function readForm(): void {
      title = titleInput.value;
      text = bodyInput.value;
      mood = moodInput.value;
      startedAt = startedPartsToIso(startedDatePicker.getValue(), startedTimePicker.getValue());
    }

    function setFormError(msg: string): void {
      formError.hidden = !msg;
      formError.textContent = msg;
    }

    function setStatus(msg: string, tone: "" | "ok" | "err" = ""): void {
      statusEl.textContent = msg;
      statusEl.className = "journal-track-editor-status";
      if (tone === "ok") statusEl.classList.add("is-ok");
      if (tone === "err") statusEl.classList.add("is-err");
    }

    function clearDebounce(): void {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }

    async function saveNote(): Promise<boolean> {
      readForm();
      if (!text.trim()) {
        setFormError("正文不能为空");
        return false;
      }
      const seq = ++saveSeq;
      setFormError("");
      setStatus("");
      try {
        if (isDraft || !entry) {
          const res = await journalArchiveCreateNote({
            startedAt,
            text: text.trim(),
            title: title.trim() || undefined,
            mood: mood.trim() || undefined,
          });
          if (seq !== saveSeq) return false;
          entry = res.entry;
          setStatus("已保存", "ok");
        } else {
          const res = await journalArchiveUpdateNote({
            id: entry.id,
            expectedRevision: entry.revision,
            text: text.trim(),
            title: title.trim() || null,
            startedAt,
            mood: mood.trim() || null,
          });
          if (seq !== saveSeq) return false;
          entry = res.entry;
          setStatus("已保存", "ok");
        }
        await reload();
        return true;
      } catch (err) {
        if (seq !== saveSeq) return false;
        setFormError(invokeErrorText(err));
        return false;
      }
    }

    async function saveDocument(): Promise<boolean> {
      readForm();
      const titleTrim = title.trim();
      if (!titleTrim) {
        setFormError("标题必填");
        return false;
      }
      const seq = ++saveSeq;
      setFormError("");
      setStatus("");
      try {
        if (isDraft || !entry) {
          const res = await journalArchiveCreateDocument({
            title: titleTrim,
            startedAt,
            markdown: text,
            mood: mood.trim() || undefined,
          });
          if (seq !== saveSeq) return false;
          entry = res.entry;
          isDraft = false;
          backdrop.querySelector<HTMLElement>('[data-region="title"]')!.textContent = "编辑文档";
          setStatus("已保存", "ok");
        } else {
          const res = await journalArchiveSaveDocument({
            id: entry.id,
            expectedRevision: entry.revision,
            title: titleTrim,
            markdown: text,
            startedAt,
            mood: mood.trim() || null,
          });
          if (seq !== saveSeq) return false;
          entry = res.entry;
          setStatus("已保存", "ok");
        }
        await reload();
        return true;
      } catch (err) {
        if (seq !== saveSeq) return false;
        setFormError(invokeErrorText(err));
        return false;
      }
    }

    function scheduleDocumentSave(): void {
      if (isNote) return;
      readForm();
      if (!title.trim()) {
        setFormError("标题必填");
        return;
      }
      clearDebounce();
      setStatus("");
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void saveDocument();
      }, AUTOSAVE_MS);
    }

    if (!isNote) {
      titleInput.addEventListener("input", () => {
        setFormError("");
        scheduleDocumentSave();
      });
      moodInput.addEventListener("input", () => {
        setFormError("");
        scheduleDocumentSave();
      });
      bodyInput.addEventListener("input", () => {
        setFormError("");
        scheduleDocumentSave();
      });
    }

    const dialog = bindDialog(backdrop);
    const closeDialog = () => {
      clearDebounce();
      unbindEsc();
      startedDatePicker.dispose();
      startedTimePicker.dispose();
      void dialog.close();
      backdrop.remove();
    };
    const unbindEsc = bindDialogEscape(closeDialog);
    backdrop.querySelector<HTMLButtonElement>('[data-action="cancel"]')?.addEventListener("click", closeDialog);
    bindBackdropPressDismiss(backdrop, closeDialog);

    backdrop.querySelector("form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!isNote) return;
      const ok = await saveNote();
      if (ok) closeDialog();
    });

    void dialog.open();
  }

  async function openEntry(entryId: string): Promise<void> {
    try {
      const res = await journalArchiveGetEntry(entryId);
      const entry = res.entry;
      if (entry.deletedAt) return;
      const kind = entrySide(entry);
      openEditor({ kind, mode: "edit", startedAt: entry.startedAt, entry });
    } catch (err) {
      setError(`无法打开：${invokeErrorText(err)}`);
    }
  }

  function openCreate(kind: JournalSide, startedUtc: number): void {
    openEditor({ kind, mode: "create", startedAt: utcToIso(startedUtc) });
  }

  function showClusterMenu(e: MouseEvent, cluster: MarkerCluster): void {
    if (cluster.entries.length === 1) {
      void openEntry(cluster.entries[0].id);
      return;
    }
    showCommandMenuAt(
      e.clientX,
      e.clientY,
      cluster.entries.map((entry) => ({
        value: entry.id,
        label: journalTabTitle(entrySide(entry), entry.title ?? "", entry.text ?? entry.markdown ?? ""),
      })),
      (entryId) => void openEntry(entryId),
    );
  }

  markersEl.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".journal-track-marker");
      if (!btn) return;
      e.stopPropagation();
      const entryId = btn.dataset.entryId;
      if (entryId) {
        void openEntry(entryId);
        return;
      }
      const plotW = lanesEl.clientWidth;
      const x = Number.parseFloat(btn.style.left);
      const cluster = clusterMarkers(placeEntries(plotW)).find(
        (c) => Math.abs(c.x - x) < 1 && c.entries.length > 1,
      );
      if (cluster) showClusterMenu(e, cluster);
    },
    { signal },
  );

  lanesEl.addEventListener(
    "click",
    (e) => {
      if (listFailed) return;
      if ((e.target as HTMLElement).closest(".journal-track-marker")) return;
      const rect = lanesEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const mid = rect.height / 2;
      const ts = timeAtPlotXClamped(x, fromUtc, toUtc, lanesEl.clientWidth);
      if (y < mid) openCreate("note", ts);
      else openCreate("document", ts);
    },
    { signal },
  );

  const w0 = initialClock ?? defaultTrackWindow(selectedDate);
  fromUtc = w0.fromUtc;
  toUtc = w0.toUtc;

  const unbindClock = clock?.subscribe(() => applyClock(clock.get())) ?? (() => {});

  const ro = new ResizeObserver(() => paint());
  ro.observe(lanesEl);
  signal.addEventListener("abort", () => ro.disconnect());

  paint();

  return {
    activate() {
      void reload();
    },
    deactivate() {},
    dispose() {
      unbindClock();
      ro.disconnect();
      root.innerHTML = "";
    },
  };
}

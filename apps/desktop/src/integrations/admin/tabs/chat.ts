import "../../../ui/markdown-content.css";
import "./chat-style.css";
import { invoke } from "@tauri-apps/api/core";
import { escAttr, escHtml } from "../../../core/html";
import { getSettings } from "../../../core/settings";
import { abortChat, chatStream, generateConversationTitle, handleSearchSourceClick, searchEvidenceHtml, type ChatMessage } from "../../ai/adapter";
import { shouldApplyGeneratedTitle, titleModelForEntry, titleSummarizePlan, uniqueAutoTitle } from "../../ai/chat-title";
import { composerTextareaStyle } from "../../ai/composer-autosize";
import { handleInsightComposerKeydown } from "../../ai/composer-md-list";
import { contextWindowForModel, estimateTokens } from "../../ai/composer-tokens";
import { getActiveEntry, getAiConfig, loadAiConfig, saveAiConfig } from "../../ai/config";
import { renderFinalMarkdown, renderIncrementalMarkdown, type IncrementalMdState } from "../../ai/incremental-md";
import { renderMarkdown, setMarkdownCacheConversation } from "../../ai/render-markdown";
import { StreamDisplayQueue } from "../../ai/stream-display";
import { openInsightContentTab } from "../tab-host/host-api";
import { defaultTabTitle, httpWebIdentity } from "../tab-host/identity";
import {
  isInsightBatchWriteTool,
  openToolConfirm,
  type ToolConfirmEvent,
} from "../../ai/tool-confirm";
import type { Conversation, ThinkingEffort as ConvThinkingEffort } from "../../ai/conversations";
import { mountFlatSelectPopover, type FlatSelectPopoverHandle, type FlatSelectSection } from "../../../ui/flat-select-popover";
import { mountOptionHint } from "../../../ui/option-hint";
import { mountSectionTitle } from "../../../ui/section-title";
import { mountSliderField, type SliderFieldHandle } from "../../../ui/slider-field";
import {
  loadInsightConversation,
  listInsightConversations,
  saveInsightConversation,
  titleFromMessage,
  uniqueInsightConversationTitle,
} from "../../ai/conversations";
import { journalArchiveGetEntry } from "../../journal/archive-client";
import { getMeal } from "../../journal/meals-archive";
import {
  productivityGetAction,
  productivityGetItem,
  productivityGetList,
  productivityGetProject,
  productivityGetSession,
} from "../../productivity/client";
import type { InsightDestination, InsightDestinationHandle, InsightHostContext } from "../types";
import { mountChatRail, releaseInsightChatScratch } from "./chat-rail";

const DEFERRED_DATADIR_MISMATCH = "数据目录已切换，不能执行该提案";
const COMPOSER_MAX_LINES = 10;
const SEND_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const STOP_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>';
const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const REGEN_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';

type AssistantStatus =
  | "searching"
  | "waiting"
  | "connected"
  | "reasoning"
  | "streaming"
  | "completed"
  | "interrupted"
  | "failed";

type AssistantMeta = {
  status: AssistantStatus;
  finishReason?: string | null;
  reasoningSeconds?: number;
};

const FADE_CLASS = "insight-chat-fade-in";

function statusLabel(status: AssistantStatus, reasoningSeconds?: number): string {
  switch (status) {
    case "searching":
      return "正在搜索网页…";
    case "waiting":
      return "正在等待响应…";
    case "connected":
      return "正在生成回答…";
    case "reasoning":
      return `正在思考 · ${reasoningSeconds ?? 0} 秒`;
    case "interrupted":
      return "已停止生成";
    case "failed":
      return "生成中断，可重试";
    default:
      return "";
  }
}

function modelBaseName(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

function thinkingEffortLabel(effort: ConvThinkingEffort): string {
  switch (effort) {
    case "low": return "低";
    case "medium": return "中";
    case "high": return "高";
    default: return "关";
  }
}

function currentDataDir(): string {
  return getSettings().dataDir.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type DeferredRevisionRefresh =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

const JOURNAL_REVISION_OP_KEYS = ["updateNote", "saveDocument", "convertNoteToDocument"] as const;
const HEALTH_REVISION_OP_KEYS = ["updateMeal"] as const;

function isInsightBatchTool(name: string): boolean {
  return isInsightBatchWriteTool(name);
}

// productivity revision refresh is limited to the gets that exist in productivity/client
const PRODUCTIVITY_REVISION_REF_PATHS: Array<{
  opKey: string;
  refKey: string;
  label: string;
  fetch: (id: string) => Promise<{ revision: number; deletedAtUtc?: string | null }>;
}> = [
  {
    opKey: "updateProject",
    refKey: "project",
    label: "Project",
    fetch: async (id) => (await productivityGetProject({ id })).project,
  },
  {
    opKey: "createTask",
    refKey: "project",
    label: "Project",
    fetch: async (id) => (await productivityGetProject({ id })).project,
  },
  {
    opKey: "updateTask",
    refKey: "project",
    label: "Project",
    fetch: async (id) => (await productivityGetProject({ id })).project,
  },
  {
    opKey: "updateList",
    refKey: "list",
    label: "List",
    fetch: async (id) => (await productivityGetList({ id })).list,
  },
  {
    opKey: "updateItem",
    refKey: "item",
    label: "Item",
    fetch: async (id) => (await productivityGetItem({ id })).item,
  },
  {
    opKey: "updateSession",
    refKey: "session",
    label: "Session",
    fetch: async (id) => (await productivityGetSession({ id })).session,
  },
  {
    opKey: "updateAction",
    refKey: "action",
    label: "Action",
    fetch: async (id) => (await productivityGetAction({ id })).action,
  },
];

async function refreshProductivityRevisionRef(
  ref: Record<string, unknown>,
  fetch: (id: string) => Promise<{ revision: number; deletedAtUtc?: string | null }>,
  label: string,
): Promise<string | null> {
  const id = ref.id;
  const expectedRevision = ref.expectedRevision;
  if (typeof id !== "string" || typeof expectedRevision !== "number") return null;
  try {
    const snap = await fetch(id);
    if (snap.deletedAtUtc) return `${label} 已删除：${id}`;
    ref.expectedRevision = snap.revision;
    return null;
  } catch {
    return `${label} 不存在：${id}`;
  }
}

async function refreshDeferredProposalArgs(
  args: Record<string, unknown>,
  domain: DeferredDomain,
): Promise<DeferredRevisionRefresh> {
  const ops = args.ops;
  if (!Array.isArray(ops)) return { ok: true, args: { ...args } };
  const nextOps = JSON.parse(JSON.stringify(ops)) as Record<string, unknown>[];

  for (const op of nextOps) {
    if (!isRecord(op)) continue;
    if (domain === "journal") {
      for (const key of JOURNAL_REVISION_OP_KEYS) {
        const body = op[key];
        if (!isRecord(body)) continue;
        const id = body.id;
        const expectedRevision = body.expectedRevision;
        if (typeof id !== "string" || typeof expectedRevision !== "number") continue;
        try {
          const res = await journalArchiveGetEntry(id);
          if (res.entry.deletedAt) {
            return { ok: false, error: `Journal 条目已删除：${id}` };
          }
          body.expectedRevision = res.entry.revision;
        } catch {
          return { ok: false, error: `Journal 条目不存在：${id}` };
        }
      }
      continue;
    }
    if (domain === "health") {
      for (const key of HEALTH_REVISION_OP_KEYS) {
        const body = op[key];
        if (!isRecord(body)) continue;
        const meal = body.meal;
        if (!isRecord(meal)) continue;
        const id = meal.id;
        const expectedRevision = meal.expectedRevision;
        if (typeof id !== "string" || typeof expectedRevision !== "number") continue;
        try {
          const res = await getMeal(id);
          if (res.meal.deletedAt) {
            return { ok: false, error: `餐食已删除：${id}` };
          }
          meal.expectedRevision = res.meal.revision;
        } catch {
          return { ok: false, error: `餐食不存在：${id}` };
        }
      }
      continue;
    }
    for (const path of PRODUCTIVITY_REVISION_REF_PATHS) {
      const opBody = op[path.opKey];
      if (!isRecord(opBody)) continue;
      const ref = opBody[path.refKey];
      if (!isRecord(ref)) continue;
      const err = await refreshProductivityRevisionRef(ref, path.fetch, path.label);
      if (err) return { ok: false, error: err };
    }
  }

  return { ok: true, args: { ...args, ops: nextOps } };
}

type DeferredDomain = "productivity" | "journal" | "health";

type DeferredProposal = {
  id: string;
  conversationId: string;
  domain: DeferredDomain;
  tool: string;
  args: Record<string, unknown>;
  dataDir: string;
  createdAt: string;
  status: "pending" | "done" | "skipped" | "failed";
  lastError?: string;
};

function surfaceKeyOf(root: HTMLElement): string {
  return root.dataset.surface ?? "";
}

function conversationIdFromState(state: unknown): string {
  if (isRecord(state) && typeof state.conversationId === "string") return state.conversationId;
  return "";
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function formatMessageAbs(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  if (Number.isNaN(today.getTime())) return "";
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatMessageRel(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function composerDraftKey(id: string) {
  return `orbita.insight.chat.composer.${id}`;
}

function readComposerDraft(id: string): string {
  if (!id) return "";
  try {
    return sessionStorage.getItem(composerDraftKey(id)) ?? "";
  } catch {
    return "";
  }
}

function writeComposerDraft(id: string, value: string) {
  if (!id) return;
  try {
    if (value) sessionStorage.setItem(composerDraftKey(id), value);
    else sessionStorage.removeItem(composerDraftKey(id));
  } catch {
    /* ignore */
  }
}

function syncChatTitles(root: HTMLElement, title: string) {
  const surfaceKey = surfaceKeyOf(root);
  if (!surfaceKey || !title) return;
  window.dispatchEvent(
    new CustomEvent("orbita:insight-tab-title", { detail: { surfaceKey, title } }),
  );
  window.dispatchEvent(new Event("orbita:insight-conversations-changed"));
}

function insightDeferredStorageKey(): string {
  const dir = getSettings().dataDir.trim() || "orbita-data";
  return `orbita.data.stores.${dir}.ai.insight.deferred`;
}

function deferredDomainForTool(tool: string): DeferredDomain | null {
  if (tool === "productivity_apply_ai_batch") return "productivity";
  if (tool === "journal_apply_ai_batch") return "journal";
  if (tool === "health_apply_ai_batch") return "health";
  return null;
}

function readDeferredProposals(): DeferredProposal[] {
  try {
    const raw = localStorage.getItem(insightDeferredStorageKey());
    if (raw) return JSON.parse(raw) as DeferredProposal[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeDeferredProposals(items: DeferredProposal[]) {
  localStorage.setItem(insightDeferredStorageKey(), JSON.stringify(items));
}

function batchInvokeCommand(domain: DeferredDomain): string {
  if (domain === "productivity") return "productivity_apply_ai_batch";
  if (domain === "health") return "health_apply_ai_batch";
  return "journal_archive_apply_ai_batch";
}

function newInsightConversation(
  id: string,
  activeEntryId: string,
  activeModel: string,
): Conversation {
  return {
    id,
    title: "新对话",
    conversationPrompt: "",
    messages: [],
    activeEntryId,
    activeModel,
    updatedAt: new Date().toISOString(),
    thinkingEffort: "off",
  };
}

export const chatDestination: InsightDestination = {
  id: "chat",
  kind: "workspace",
  label: "新对话",
  icon: "journal",
  showInNav: false,
  mount(root, ctx: InsightHostContext) {
    let conversation: Conversation | null = null;
    let conversationId = "";
    const messages: ChatMessage[] = [];
    let streaming = false;
    let requestId: string | null = null;
    let activeStreamGen = 0;
    let activeToolConfirmAbort: AbortController | null = null;
    const assistantMeta = new Map<number, AssistantMeta>();
    let messagesScrollHeight = 0;
    let streamQueue: StreamDisplayQueue | null = null;
    let reasoningTimer: ReturnType<typeof setInterval> | null = null;
    let reasoningStartMs = 0;
    let liveAssistantEl: HTMLElement | null = null;
    let liveMdState: IncrementalMdState | null = null;
    let modelMenuPopover: FlatSelectPopoverHandle | null = null;
    let temperatureSlider: SliderFieldHandle | null = null;
    let localTemperature = 1;
    let expanded = false;
    let configError = "";
    let activeModel = "";
    let activeEntry: ReturnType<typeof getActiveEntry> = null;
    let timeTick: ReturnType<typeof setInterval> | null = null;
    let titleJobGen = 0;
    let persistTail: Promise<void> = Promise.resolve();

    root.innerHTML = `
      <div class="insight-chat-page">
        <aside class="insight-chat-rail" data-region="rail"></aside>
        <div class="insight-chat-main">
          <div class="insight-chat-main-bar">
            <div class="insight-chat-heading" data-region="heading">新对话</div>
            <input type="text" class="insight-chat-heading-edit" data-region="heading-edit" hidden spellcheck="false" />
            <button type="button" class="insight-chat-more" data-region="more" aria-label="更多">⋯</button>
          </div>
          <div class="insight-chat-config-error" data-region="config-error" hidden></div>
          <div class="insight-chat-viewport">
            <div class="insight-chat-fade insight-chat-fade-top" aria-hidden="true"></div>
            <div class="insight-chat-messages scroll-slim" data-region="messages"></div>
            <div class="insight-chat-fade insight-chat-fade-bottom" aria-hidden="true"></div>
          </div>
          <div class="insight-chat-deferred" data-region="deferred" hidden></div>
          <form class="insight-chat-composer" data-region="form">
            <div class="insight-chat-composer-box">
              <div class="insight-chat-attach" data-region="attach" hidden></div>
              <textarea data-region="input" rows="1" placeholder="输入消息…"></textarea>
              <div class="insight-chat-composer-tools">
                <button type="button" class="insight-chat-plus" data-region="plus" aria-label="添加文件">+</button>
                <input type="file" data-region="file" accept="image/*,.pdf,.txt,.md,.csv,.json" multiple hidden>
                <div class="insight-chat-token" data-region="token" title="上下文">
                  <div class="insight-chat-token-track"><div class="insight-chat-token-fill"></div></div>
                </div>
                <button type="button" class="insight-chat-model" data-region="model"></button>
                <button type="submit" class="insight-chat-send" data-region="send" aria-label="发送">${SEND_ICON}</button>
              </div>
            </div>
          </form>
        </div>
      </div>`;

    const page = root.querySelector<HTMLElement>(".insight-chat-page")!;
    const chatRail = mountChatRail(page, ctx);
    const headingEl = root.querySelector<HTMLElement>('[data-region="heading"]')!;
    const headingEdit = root.querySelector<HTMLInputElement>('[data-region="heading-edit"]')!;
    const configErrorEl = root.querySelector<HTMLElement>('[data-region="config-error"]')!;
    const messagesEl = root.querySelector<HTMLElement>('[data-region="messages"]')!;
    const deferredEl = root.querySelector<HTMLElement>('[data-region="deferred"]')!;
    const form = root.querySelector<HTMLFormElement>('[data-region="form"]')!;
    const plusBtn = root.querySelector<HTMLButtonElement>('[data-region="plus"]')!;
    const fileInput = root.querySelector<HTMLInputElement>('[data-region="file"]')!;
    const attachEl = root.querySelector<HTMLElement>('[data-region="attach"]')!;
    const input = root.querySelector<HTMLTextAreaElement>('[data-region="input"]')!;
    const sendBtn = root.querySelector<HTMLButtonElement>('[data-region="send"]')!;
    const modelBtn = root.querySelector<HTMLButtonElement>('[data-region="model"]')!;
    const tokenFill = root.querySelector<HTMLElement>(".insight-chat-token-fill")!;
    const attachments: File[] = [];

    function renderDeferredProposals() {
      if (!conversation) {
        deferredEl.hidden = true;
        deferredEl.innerHTML = "";
        return;
      }
      const items = readDeferredProposals().filter(
        (item) =>
          item.conversationId === conversation!.id &&
          (item.status === "pending" || item.status === "failed"),
      );
      if (items.length === 0) {
        deferredEl.hidden = true;
        deferredEl.innerHTML = "";
        return;
      }
      deferredEl.hidden = false;
      deferredEl.innerHTML = items
        .map((item) => {
          const label =
            item.domain === "productivity"
              ? "Productivity"
              : item.domain === "health"
                ? "Health"
                : "Journal";
          const err = item.lastError
            ? `<p class="settings-hint" style="color:var(--danger,#c62828)">${escHtml(item.lastError)}</p>`
            : "";
          return `<div class="insight-chat-deferred-item" data-deferred-id="${escHtml(item.id)}">
            <span>${escHtml(label)} 批量写入待核对</span>
            ${err}
            <div class="insight-chat-deferred-actions">
              <button type="button" class="dialog-btn" data-action="skip">跳过</button>
              <button type="button" class="dialog-btn dialog-btn-primary" data-action="review">重新核对</button>
            </div>
          </div>`;
        })
        .join("");
    }

    function appendDeferredProposal(event: ToolConfirmEvent) {
      const domain = deferredDomainForTool(event.name);
      if (!domain || !conversation) return;
      const items = readDeferredProposals();
      items.push({
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        domain,
        tool: event.name,
        args: event.args,
        dataDir: currentDataDir(),
        createdAt: new Date().toISOString(),
        status: "pending",
      });
      writeDeferredProposals(items);
      renderDeferredProposals();
    }

    function updateDeferredProposal(id: string, patch: Partial<DeferredProposal>) {
      const items = readDeferredProposals();
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) return;
      items[idx] = { ...items[idx], ...patch };
      writeDeferredProposals(items);
      renderDeferredProposals();
    }

    function deferDataDirMismatch(item: DeferredProposal): boolean {
      if (currentDataDir() === item.dataDir) return false;
      updateDeferredProposal(item.id, {
        status: "failed",
        lastError: DEFERRED_DATADIR_MISMATCH,
      });
      return true;
    }

    async function executeDeferredProposal(item: DeferredProposal, args: Record<string, unknown>) {
      if (deferDataDirMismatch(item)) return;
      try {
        await invoke(batchInvokeCommand(item.domain), { req: { ...args, expectedDataDir: item.dataDir } });
        updateDeferredProposal(item.id, { status: "done", lastError: undefined });
      } catch (e) {
        updateDeferredProposal(item.id, { status: "failed", lastError: String(e) });
      }
    }

    async function reviewDeferredProposal(item: DeferredProposal) {
      if (deferDataDirMismatch(item)) return;
      const refreshed = await refreshDeferredProposalArgs(item.args, item.domain);
      if (!refreshed.ok) {
        updateDeferredProposal(item.id, { status: "failed", lastError: refreshed.error });
        return;
      }
      const result = await openToolConfirm(document.body, {
        name: item.tool,
        label:
          item.domain === "productivity"
            ? "确认 Productivity"
            : item.domain === "health"
              ? "确认 Health"
              : "确认 Journal",
        args: refreshed.args,
      });
      if (result === "defer" || result === null) return;
      if (deferDataDirMismatch(item)) return;
      await executeDeferredProposal(item, result);
    }

    deferredEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
      if (!btn) return;
      const wrap = btn.closest<HTMLElement>("[data-deferred-id]");
      const id = wrap?.dataset.deferredId;
      if (!id) return;
      const item = readDeferredProposals().find((x) => x.id === id);
      if (!item) return;
      if (btn.dataset.action === "skip") {
        updateDeferredProposal(id, { status: "skipped" });
        return;
      }
      if (btn.dataset.action === "review") {
        void reviewDeferredProposal(item);
      }
    });

    async function handleInsightToolConfirm(
      event: ToolConfirmEvent,
      assistantIdx: number,
      streamGen: number,
      signal: AbortSignal,
    ) {
      const confirmId = event.confirmId ?? event.confirm_id;
      if (!confirmId) return;
      const reject = async (reason?: string) => {
        try {
          await invoke("agent_tool_reject", { req: { confirmId, reason } });
        } catch {
          /* backend may already be aborted */
        }
      };
      if (!requestId || streamGen !== activeStreamGen || signal.aborted) {
        await reject("会话已中断");
        return;
      }
      const host = ensureLiveAssistantDom(assistantIdx);
      const wasPinned = isMessagesPinned();
      let result: Awaited<ReturnType<typeof openToolConfirm>>;
      try {
        result = await openToolConfirm(host, event, {
          presentation: "inline",
          signal,
          onMount() {
            if (wasPinned) messagesEl.scrollTop = messagesEl.scrollHeight;
            syncMessagesScrollHeight();
          },
        });
      } catch (error) {
        host.insertAdjacentHTML("beforeend", `<p class="insight-tool-confirm-error">确认表单加载失败：${escHtml(String(error))}</p>`);
        await reject("确认表单加载失败");
        return;
      }
      if (result === "defer") {
        await reject("已延后");
        if (isInsightBatchTool(event.name)) appendDeferredProposal(event);
        return;
      }
      if (result === null) {
        await reject(signal.aborted ? "会话已中断" : undefined);
        return;
      }
      if (!requestId || streamGen !== activeStreamGen || signal.aborted) {
        await reject("会话已中断");
        return;
      }
      try {
        await invoke("agent_tool_confirm", { req: { confirmId, args: result } });
      } catch (error) {
        host.insertAdjacentHTML("beforeend", `<p class="insight-tool-confirm-error">提交确认失败：${escHtml(String(error))}</p>`);
        await reject("提交确认失败");
      }
    }

    function syncMessagesFromConversation() {
      messages.length = 0;
      if (conversation) messages.push(...conversation.messages);
    }

    function isMessagesPinned() {
      return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 96;
    }

    function scrollMessagesIfPinned() {
      if (!isMessagesPinned()) return;
      const next = messagesEl.scrollHeight;
      const growth = next - messagesScrollHeight;
      if (growth > 0) messagesEl.scrollTop += growth;
      messagesScrollHeight = next;
    }

    function syncMessagesScrollHeight() {
      messagesScrollHeight = messagesEl.scrollHeight;
    }

    function messageStamp(m: ChatMessage): string {
      return m.createdAt || conversation?.updatedAt || "";
    }

    function renderTimeBtn(iso: string) {
      const abs = formatMessageAbs(iso);
      if (!abs) return "";
      return `<button type="button" class="insight-chat-msg-time" data-action="time" data-iso="${escAttr(iso)}" data-rel="0">${escHtml(abs)}</button>`;
    }

    function renderAssistantActions(index: number, showRetry = false, iso = "") {
      const retryBtn = showRetry
        ? `<button type="button" class="insight-chat-action-btn" data-action="retry" data-index="${index}" aria-label="重试">${REGEN_ICON}</button>`
        : "";
      return `<div class="insight-chat-actions">
        <button type="button" class="insight-chat-action-btn" data-action="copy" data-index="${index}" aria-label="复制">${COPY_ICON}</button>
        <button type="button" class="insight-chat-action-btn" data-action="regenerate" data-index="${index}" aria-label="重新生成">${REGEN_ICON}</button>
        ${retryBtn}
        ${renderTimeBtn(iso)}
      </div>`;
    }

    function renderAssistantMessage(m: ChatMessage, i: number, live = false) {
      const meta = assistantMeta.get(i);
      const status = meta?.status;
      const showStatus =
        status && ["searching", "waiting", "connected", "reasoning", "interrupted", "failed"].includes(status);
      const statusHtml = showStatus
        ? `<div class="insight-chat-status is-breathing">${escHtml(statusLabel(status!, meta?.reasoningSeconds))}</div>`
        : "";
      const reasoning = m.reasoning?.trim() ?? "";
      const reasoningHtml =
        reasoning && status !== "searching" && status !== "waiting" && status !== "connected"
          ? `<div class="insight-chat-reasoning">
              <button type="button" class="insight-chat-reasoning-toggle" data-reasoning-toggle="${i}">
                ${meta?.reasoningSeconds ? `思考了 ${meta.reasoningSeconds} 秒` : "查看思考过程"}
              </button>
              <div class="insight-chat-reasoning-body" hidden>${escHtml(reasoning)}</div>
            </div>`
          : "";
      const bodyHtml = m.content
        ? `<div class="insight-chat-body"><div class="ai-md orbita-markdown">${live ? "" : renderMarkdown(m.content, i)}</div></div>`
        : `<div class="insight-chat-body"><div class="ai-md orbita-markdown"></div></div>`;
      const lengthHint =
        meta?.finishReason === "length"
          ? `<div class="insight-chat-length-hint">回答未完整结束</div>`
          : "";
      const generating =
        live ||
        status === "waiting" ||
        status === "searching" ||
        status === "connected" ||
        status === "reasoning" ||
        status === "streaming";
      const actions = generating
        ? ""
        : status === "failed" || m.content.trim() || m.reasoning?.trim()
          ? renderAssistantActions(i, status === "failed", messageStamp(m))
          : "";
      return `<div class="insight-chat-msg insight-chat-msg-assistant" data-index="${i}">
        ${statusHtml}
        ${reasoningHtml}
        ${bodyHtml}
        ${m.searchStatus === "searching" ? "" : searchEvidenceHtml(m)}
        ${lengthHint}
        ${actions}
      </div>`;
    }

    function renderMessages() {
      liveAssistantEl = null;
      liveMdState = null;
      messagesEl.innerHTML = messages
        .map((m, i) => {
          if (m.role === "user") {
            const body = `<div class="ai-md orbita-markdown">${renderMarkdown(m.content, i)}</div>`;
            return `<div class="insight-chat-msg insight-chat-msg-user" data-index="${i}"><div class="insight-chat-bubble">${body}</div></div>`;
          }
          return renderAssistantMessage(m, i);
        })
        .join("");
      syncMessagesScrollHeight();
      if (isMessagesPinned()) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function ensureLiveAssistantDom(index: number) {
      let el = messagesEl.querySelector<HTMLElement>(`.insight-chat-msg-assistant[data-index="${index}"]`);
      if (!el) {
        messagesEl.insertAdjacentHTML("beforeend", renderAssistantMessage(messages[index], index, true));
        el = messagesEl.querySelector<HTMLElement>(`.insight-chat-msg-assistant[data-index="${index}"]`)!;
      }
      liveAssistantEl = el;
      return el;
    }

    function updateLiveStatus(index: number, status: AssistantStatus, reasoningSeconds?: number) {
      const el = liveAssistantEl ?? ensureLiveAssistantDom(index);
      const statusEl = el.querySelector<HTMLElement>(".insight-chat-status");
      if (["streaming", "completed"].includes(status)) {
        statusEl?.remove();
        return;
      }
      const label = statusLabel(status, reasoningSeconds);
      if (statusEl) {
        statusEl.textContent = label;
        statusEl.classList.toggle("is-breathing", status !== "interrupted" && status !== "failed");
      } else if (label) {
        el.insertAdjacentHTML(
          "afterbegin",
          `<div class="insight-chat-status is-breathing">${escHtml(label)}</div>`,
        );
      }
    }

    function updateLiveBody(index: number, html: string, fadeNew = false) {
      const el = liveAssistantEl ?? ensureLiveAssistantDom(index);
      const md = el.querySelector<HTMLElement>(".insight-chat-body .ai-md");
      if (md) {
        md.innerHTML = html;
        md.classList.toggle(FADE_CLASS, fadeNew);
      }
      scrollMessagesIfPinned();
    }

    function updateLiveReasoning(index: number, text: string) {
      const el = liveAssistantEl ?? ensureLiveAssistantDom(index);
      let wrap = el.querySelector<HTMLElement>(".insight-chat-reasoning");
      if (!wrap) {
        const statusEl = el.querySelector(".insight-chat-status");
        const html = `<div class="insight-chat-reasoning">
          <button type="button" class="insight-chat-reasoning-toggle" data-reasoning-toggle="${index}">查看思考过程</button>
          <div class="insight-chat-reasoning-body" hidden></div>
        </div>`;
        if (statusEl) statusEl.insertAdjacentHTML("afterend", html);
        else el.insertAdjacentHTML("afterbegin", html);
        wrap = el.querySelector<HTMLElement>(".insight-chat-reasoning");
      }
      const body = wrap?.querySelector<HTMLElement>(".insight-chat-reasoning-body");
      if (body) body.textContent = text;
    }

    function stopReasoningTimer() {
      if (reasoningTimer) {
        clearInterval(reasoningTimer);
        reasoningTimer = null;
      }
    }

    function startReasoningTimer(index: number) {
      if (reasoningTimer) return;
      reasoningStartMs = Date.now();
      reasoningTimer = setInterval(() => {
        const secs = Math.floor((Date.now() - reasoningStartMs) / 1000);
        const meta = assistantMeta.get(index);
        if (meta) meta.reasoningSeconds = secs;
        updateLiveStatus(index, "reasoning", secs);
      }, 1000);
    }

    function finalizeReasoning(index: number, m: ChatMessage) {
      stopReasoningTimer();
      const meta = assistantMeta.get(index);
      if (!meta) return;
      const secs = meta.reasoningSeconds ?? Math.floor((Date.now() - reasoningStartMs) / 1000);
      meta.reasoningSeconds = secs;
      const el = liveAssistantEl ?? messagesEl.querySelector<HTMLElement>(`.insight-chat-msg-assistant[data-index="${index}"]`);
      if (!el || !m.reasoning?.trim()) return;
      const existing = el.querySelector(".insight-chat-reasoning");
      if (existing) return;
      const statusEl = el.querySelector(".insight-chat-status");
      const html = `<div class="insight-chat-reasoning">
        <button type="button" class="insight-chat-reasoning-toggle" data-reasoning-toggle="${index}">思考了 ${secs} 秒</button>
        <div class="insight-chat-reasoning-body" hidden>${escHtml(m.reasoning)}</div>
      </div>`;
      if (statusEl) statusEl.insertAdjacentHTML("afterend", html);
      else el.insertAdjacentHTML("afterbegin", html);
    }

    function showLiveActions(index: number, failed = false) {
      const el = liveAssistantEl ?? messagesEl.querySelector<HTMLElement>(`.insight-chat-msg-assistant[data-index="${index}"]`);
      if (!el || el.querySelector(".insight-chat-actions")) return;
      el.insertAdjacentHTML("beforeend", renderAssistantActions(index, failed, messageStamp(messages[index])));
    }

    function showLengthHint(index: number) {
      const el = liveAssistantEl ?? messagesEl.querySelector<HTMLElement>(`.insight-chat-msg-assistant[data-index="${index}"]`);
      if (!el || el.querySelector(".insight-chat-length-hint")) return;
      el.insertAdjacentHTML("beforeend", `<div class="insight-chat-length-hint">回答未完整结束</div>`);
    }

    function disposeStreamQueue() {
      streamQueue?.dispose();
      streamQueue = null;
      liveMdState = null;
      stopReasoningTimer();
    }

    messagesEl.addEventListener("click", (e) => {
      if (handleSearchSourceClick(e)) return;
      const target = e.target as HTMLElement;
      const actionBtn = target.closest<HTMLButtonElement>("[data-action]");
      if (actionBtn?.dataset.action && actionBtn.dataset.index) {
        const idx = Number(actionBtn.dataset.index);
        const action = actionBtn.dataset.action;
        if (action === "copy") {
          const text = messages[idx]?.content ?? "";
          if (text) void navigator.clipboard.writeText(text);
        } else if (action === "regenerate" || action === "retry") {
          void regenerateFromIndex(idx);
        } else if (action === "time") {
          const iso = actionBtn.dataset.iso ?? "";
          const rel = actionBtn.dataset.rel === "1";
          actionBtn.dataset.rel = rel ? "0" : "1";
          actionBtn.textContent = rel ? formatMessageAbs(iso) : formatMessageRel(iso);
        }
        return;
      }
      const reasoningToggle = target.closest<HTMLButtonElement>("[data-reasoning-toggle]");
      if (reasoningToggle) {
        const body = reasoningToggle.parentElement?.querySelector<HTMLElement>(".insight-chat-reasoning-body");
        if (body) body.hidden = !body.hidden;
        return;
      }
      const a = target.closest("a");
      if (!a || !messagesEl.contains(a)) return;
      const href = a.getAttribute("href");
      if (!href) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      e.preventDefault();
      const identity = httpWebIdentity(url.href);
      if (!identity) return;
      openInsightContentTab(identity, defaultTabTitle(identity));
    });

    function applyTextareaHeight() {
      const computed = getComputedStyle(input);
      const lineHeight = parseFloat(computed.lineHeight);
      const paddingTop = parseFloat(computed.paddingTop);
      const paddingBottom = parseFloat(computed.paddingBottom);
      const minHeight = parseFloat(computed.minHeight);
      input.style.height = `${minHeight}px`;
      const style = composerTextareaStyle({
        expanded,
        scrollHeight: input.scrollHeight,
        lineHeight,
        minHeight,
        maxLines: COMPOSER_MAX_LINES,
        paddingTop,
        paddingBottom,
      });
      input.style.height = style.height;
      input.style.overflowY = style.overflowY;
    }

    function renderAttachments() {
      if (attachments.length === 0) {
        attachEl.hidden = true;
        attachEl.innerHTML = "";
        return;
      }
      attachEl.hidden = false;
      attachEl.innerHTML = attachments
        .map(
          (file, i) =>
            `<span class="insight-chat-attach-chip">${escHtml(file.name)}<button type="button" data-attach-remove="${i}" aria-label="移除">×</button></span>`,
        )
        .join("");
    }

    function syncTokenBar() {
      const draft = input.value;
      const used = estimateTokens(
        messages.map((m) => m.content).join("") + draft,
      );
      const limit = contextWindowForModel(activeModel || conversation?.activeModel || "");
      const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      tokenFill.style.width = `${pct}%`;
    }

    function syncModelBtn() {
      const model = conversation?.activeModel || activeModel;
      modelBtn.textContent = modelBaseName(model);
      modelBtn.title = model;
    }

    function buildModelMenuSections(): { sections: FlatSelectSection[]; selected: Set<string> } {
      if (!conversation) return { sections: [], selected: new Set() };
      const config = getAiConfig();
      const modelOptions = config.entries.flatMap((entry) =>
        entry.models.map((model) => ({
          value: `model:${entry.id}\x1f${model}`,
          label: modelBaseName(model),
          hint: mountOptionHint(entry.name).element,
        })),
      );
      const thinkingOptions = [
        { value: "effort:off", label: "关" },
        { value: "effort:low", label: "低" },
        { value: "effort:medium", label: "中" },
        { value: "effort:high", label: "高" },
      ];
      const selectedModel = `model:${conversation.activeEntryId}\x1f${conversation.activeModel}`;
      const effort = conversation.thinkingEffort ?? "off";
      const temperatureSlot = document.createElement("div");
      temperatureSlot.className = "insight-chat-temperature";
      temperatureSlider = mountSliderField({
        min: 0,
        max: 2,
        step: 0.01,
        value: localTemperature,
        label: "温度",
        onChange: (value) => {
          localTemperature = value;
          modelMenuPopover?.setOptionLabel("temperature", String(value));
        },
      });
      temperatureSlot.append(temperatureSlider.element);
      return {
        sections: [
          { title: mountSectionTitle("模型").element, options: modelOptions },
          { options: [
            { value: "thinking", label: thinkingEffortLabel(effort), title: mountSectionTitle("思考程度").element, children: thinkingOptions },
            { value: "temperature", label: String(localTemperature), title: mountSectionTitle("温度").element, submenu: temperatureSlot },
          ] },
          { options: [{ value: "settings", label: "设置", disabled: true }] },
        ],
        selected: new Set([selectedModel, `effort:${effort}`]),
      };
    }

    function createModelMenuPopover() {
      modelMenuPopover?.dispose();
      temperatureSlider?.dispose();
      const { sections, selected } = buildModelMenuSections();
      modelMenuPopover = mountFlatSelectPopover({
        anchor: modelBtn,
        options: [],
        sections,
        selected,
        multiple: false,
        search: false,
        onChange: (values) => {
          const value = values.values().next().value;
          if (!value || !conversation) return;
          if (value.startsWith("model:")) {
            const [entryId, model] = value.slice("model:".length).split("\x1f");
            if (!entryId || !model) return;
            const cfg = getAiConfig();
            conversation.activeEntryId = entryId;
            conversation.activeModel = model;
            activeModel = model;
            activeEntry = cfg.entries.find((e) => e.id === entryId) ?? cfg.entries[0] ?? null;
            void saveAiConfig({ ...cfg, activeEntryId: entryId, activeModel: model })
              .then(() => persistConversation());
            syncModelBtn();
            syncTokenBar();
          } else if (value.startsWith("effort:")) {
            conversation.thinkingEffort = value.slice("effort:".length) as ConvThinkingEffort;
            void persistConversation();
          }
        },
      });
      return modelMenuPopover;
    }

    function syncSendBtn() {
      sendBtn.disabled = !!configError;
      sendBtn.classList.toggle("is-stop", streaming);
      sendBtn.setAttribute("aria-label", streaming ? "停止" : "发送");
      sendBtn.innerHTML = streaming ? STOP_ICON : SEND_ICON;
    }

    function setStreaming(on: boolean) {
      streaming = on;
      input.disabled = on || !!configError;
      plusBtn.disabled = on;
      syncSendBtn();
    }

    function showConfigError(msg: string) {
      configError = msg;
      configErrorEl.textContent = msg;
      configErrorEl.hidden = !msg;
      input.disabled = !!msg || streaming;
      syncSendBtn();
    }

    let renaming = false;
    let renameOriginal = "";

    function paintHeading(title: string) {
      if (renaming) return;
      headingEl.textContent = title;
    }

    function stopRename(restore: boolean) {
      if (!renaming) return;
      renaming = false;
      headingEdit.classList.remove("is-invalid");
      headingEdit.hidden = true;
      headingEl.hidden = false;
      if (restore) headingEl.textContent = renameOriginal;
    }

    async function commitRename() {
      const title = headingEdit.value.trim();
      if (!title) {
        headingEdit.classList.add("is-invalid");
        return;
      }
      renaming = false;
      headingEdit.classList.remove("is-invalid");
      headingEdit.hidden = true;
      headingEl.hidden = false;
      await ensureConversation();
      if (!conversation) {
        headingEl.textContent = renameOriginal;
        return;
      }
      conversation.titleLocked = true;
      ++titleJobGen;
      conversation.title = await uniqueInsightConversationTitle(title, conversation.id);
      await persistConversation();
    }

    function startRename() {
      if (renaming) return;
      renameOriginal = (headingEl.textContent ?? "").trim() || conversation?.title || "新对话";
      renaming = true;
      headingEl.hidden = true;
      headingEdit.hidden = false;
      headingEdit.value = renameOriginal;
      headingEdit.classList.remove("is-invalid");
      headingEdit.focus();
      headingEdit.select();
    }

    async function persistConversation() {
      if (!conversation) return;
      const current = conversation;
      const last = messages[messages.length - 1];
      const diskMessages =
        last?.role === "assistant" && !last.content.trim() && !last.reasoning?.trim()
          ? messages.slice(0, -1)
          : messages;
      // Serialize whole-conversation writes so an older title save cannot finish after a newer round.
      const snapshot = structuredClone({ ...current, messages: diskMessages });
      const save = persistTail.then(() => saveInsightConversation(snapshot));
      persistTail = save.catch(() => {});
      await save;
      if (conversation !== current) return;
      if (diskMessages.some((m) => m.role === "user")) releaseInsightChatScratch(current.id);
      paintHeading(current.title);
      chatRail.setActive(current.id);
      syncChatTitles(root, current.title);
    }

    function requestTitleSummarize() {
      if (!conversation || !activeEntry) return;
      const plan = titleSummarizePlan({
        titleLocked: conversation.titleLocked,
        messages,
        currentTitle: conversation.title,
      });
      if (!plan) return;
      const job = ++titleJobGen;
      const convId = conversation.id;
      const entry = activeEntry;
      const model = titleModelForEntry(entry.models, conversation.activeModel);
      void (async () => {
        let title = "";
        try {
          title = (
            await generateConversationTitle(plan.transcript, "", entry, model, plan.currentTitle)
          ).trim();
        } catch {
          return;
        }
        if (job !== titleJobGen) return;
        if (!shouldApplyGeneratedTitle(title)) return;
        if (!conversation || conversation.id !== convId || conversation.titleLocked) return;
        if (conversation.title === title) return;
        const usedTitles = (await listInsightConversations())
          .filter((item) => item.id !== convId)
          .map((item) => item.title);
        const uniqueTitle = uniqueAutoTitle(title, usedTitles);
        if (job !== titleJobGen) return;
        if (!conversation || conversation.id !== convId || conversation.titleLocked) return;
        if (conversation.title === uniqueTitle) return;
        conversation.title = uniqueTitle;
        await persistConversation();
      })();
    }

    async function ensureConversation() {
      if (conversation) return;
      if (!activeEntry) return;
      const id = conversationId || crypto.randomUUID();
      conversationId = id;
      try {
        conversation = await loadInsightConversation(id);
      } catch {
        conversation = newInsightConversation(id, activeEntry.id, activeModel);
      }
      if (conversation.activeModel) activeModel = conversation.activeModel;
      setMarkdownCacheConversation(conversation.id);
      syncMessagesFromConversation();
      renderMessages();
      renderDeferredProposals();
      paintHeading(conversation.title);
      chatRail.setActive(conversation.id);
      syncChatTitles(root, conversation.title);
    }

    let initPromise: Promise<void> | null = null;

    async function initConfig() {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          const config = await loadAiConfig();
          activeEntry = getActiveEntry(config);
          activeModel = config.activeModel;
          if (!activeEntry) {
            showConfigError("请先在 AI 设置中添加 API");
            return;
          }
          if (!activeEntry.apiKey.trim()) {
            showConfigError("请先在设置中填写 API Key");
            return;
          }
          showConfigError("");
          await ensureConversation();
          if (!input.value) {
            input.value = readComposerDraft(conversationId);
            applyTextareaHeight();
          }
          syncModelBtn();
          syncTokenBar();
          applyTextareaHeight();
        } catch (e) {
          showConfigError(String(e));
        }
      })();
      return initPromise;
    }

    async function stopStreaming() {
      if (!streaming || !requestId) return;
      activeStreamGen++;
      activeToolConfirmAbort?.abort();
      activeToolConfirmAbort = null;
      const id = requestId;
      requestId = null;
      setStreaming(false);
      streamQueue?.flushNow();
      disposeStreamQueue();
      void abortChat(id);
      const idx = messages.length - 1;
      const last = messages[idx];
      if (last?.role === "assistant") {
        const meta = assistantMeta.get(idx) ?? { status: "interrupted" as AssistantStatus };
        meta.status = "interrupted";
        if (meta.reasoningSeconds === undefined && reasoningStartMs > 0) {
          meta.reasoningSeconds = Math.floor((Date.now() - reasoningStartMs) / 1000);
        }
        assistantMeta.set(idx, meta);
        if (!last.content.trim() && !last.reasoning?.trim()) {
          messages.pop();
          assistantMeta.delete(idx);
          if (conversation) conversation.messages.pop();
        } else if (conversation) {
          conversation.messages = [...messages];
          await persistConversation();
        }
      }
      renderMessages();
      syncTokenBar();
      input.focus();
    }

    async function regenerateFromIndex(assistantIndex: number) {
      if (streaming || configError || !activeEntry || !conversation) return;
      const userIdx = assistantIndex - 1;
      if (userIdx < 0 || messages[userIdx]?.role !== "user") return;
      ++titleJobGen;
      const userText = messages[userIdx].content;
      messages.splice(assistantIndex, 1);
      assistantMeta.delete(assistantIndex);
      conversation.messages = [...messages];
      await persistConversation();
      renderMessages();
      await sendMessage(userText, true);
    }

    async function sendMessage(text: string, isRegenerate = false) {
      if (configError || !activeEntry || !conversation) return;
      const trimmed = text.trim();
      const attachNote = isRegenerate ? "" : attachments.map((file) => `[附件] ${file.name}`).join("\n");
      const payload = [trimmed, attachNote].filter(Boolean).join("\n");
      if (!payload || streaming) return;

      ++titleJobGen;

      const isFirstRound = conversation.messages.length === 0;
      if (isFirstRound) {
        const base = titleFromMessage(trimmed);
        const firstRoundId = conversation.id;
        const usedTitles = (await listInsightConversations())
          .filter((item) => item.id !== firstRoundId)
          .map((item) => item.title);
        if (!conversation || conversation.id !== firstRoundId) return;
        conversation.title = uniqueAutoTitle(base, usedTitles);
        syncChatTitles(root, conversation.title);
      }

      const createdAt = new Date().toISOString();
      if (!isRegenerate) {
        messages.push({ role: "user", content: payload, createdAt });
      }
      const assistant: ChatMessage = { role: "assistant", content: "", createdAt };
      messages.push(assistant);
      const assistantIdx = messages.length - 1;
      assistantMeta.set(assistantIdx, { status: "waiting" });
      conversation.messages = [...messages];
      await persistConversation();
      renderMessages();
      ensureLiveAssistantDom(assistantIdx);
      updateLiveStatus(assistantIdx, "waiting");
      writeComposerDraft(conversationId, "");
      input.value = "";
      attachments.length = 0;
      renderAttachments();
      expanded = false;
      applyTextareaHeight();
      syncTokenBar();
      scrollMessagesIfPinned();

      requestId = crypto.randomUUID();
      const gen = ++activeStreamGen;
      activeToolConfirmAbort?.abort();
      const toolConfirmAbort = new AbortController();
      activeToolConfirmAbort = toolConfirmAbort;
      setStreaming(true);
      disposeStreamQueue();

      let fullBuffer = "";
      let reasoningBuffer = "";
      let gotReasoning = false;
      let gotContent = false;
      let finishReason: string | null = null;
      let streamFailed = false;

      streamQueue = new StreamDisplayQueue({
        onFlush: (visible, isFinal) => {
          if (gen !== activeStreamGen) return;
          if (isFinal) {
            updateLiveBody(assistantIdx, renderFinalMarkdown(visible, assistantIdx), false);
            liveMdState = null;
            return;
          }
          liveMdState = renderIncrementalMarkdown(visible, assistantIdx, liveMdState);
          updateLiveBody(assistantIdx, liveMdState.stableHtml, liveMdState.fadeNew);
        },
      });

      await chatStream(
        requestId,
        messages.slice(0, -1),
        activeEntry,
        conversation.activeModel,
        (event) => {
          if (gen !== activeStreamGen) return;
          const meta = assistantMeta.get(assistantIdx)!;
          if (event.type === "searchStart") {
            assistant.searchStatus = "searching";
            meta.status = "searching";
            updateLiveStatus(assistantIdx, "searching");
          } else if (event.type === "searchDone") {
            assistant.searchStatus = "verified";
            assistant.sources = event.sources;
            meta.status = "waiting";
            updateLiveStatus(assistantIdx, "waiting");
            const el = ensureLiveAssistantDom(assistantIdx);
            el.querySelectorAll(".ai-search-sources, .ai-search-status").forEach((item) => item.remove());
            el.insertAdjacentHTML("beforeend", searchEvidenceHtml(assistant));
          } else if (event.type === "searchError") {
            assistant.searchStatus = `failed:${event.message}`;
            meta.status = "waiting";
            updateLiveStatus(assistantIdx, "waiting");
            const el = ensureLiveAssistantDom(assistantIdx);
            el.querySelectorAll(".ai-search-sources, .ai-search-status").forEach((item) => item.remove());
            el.insertAdjacentHTML("beforeend", searchEvidenceHtml(assistant));
          } else if (event.type === "connected") {
            if (!gotReasoning && !gotContent) {
              meta.status = "connected";
              updateLiveStatus(assistantIdx, "connected");
            }
          } else if (event.type === "reasoning") {
            if (!gotReasoning) {
              gotReasoning = true;
              meta.status = "reasoning";
              startReasoningTimer(assistantIdx);
            }
            reasoningBuffer += event.content;
            assistant.reasoning = reasoningBuffer;
            updateLiveReasoning(assistantIdx, reasoningBuffer);
          } else if (event.type === "chunk") {
            if (!gotContent) {
              gotContent = true;
              stopReasoningTimer();
              finalizeReasoning(assistantIdx, assistant);
              meta.status = "streaming";
              updateLiveStatus(assistantIdx, "streaming");
            }
            fullBuffer += event.content;
            assistant.content = fullBuffer;
            streamQueue?.push(event.content);
          } else if (event.type === "finish") {
            if (event.reason) finishReason = event.reason;
          } else if (event.type === "toolConfirm") {
            const toolPayload = {
              confirmId: event.confirmId,
              confirm_id: event.confirm_id,
              name: event.name,
              label: event.label,
              args: event.args,
            };
            void handleInsightToolConfirm(toolPayload, assistantIdx, gen, toolConfirmAbort.signal);
          } else if (event.type === "error") {
            streamFailed = true;
            meta.status = "failed";
            if (!assistant.content.trim()) assistant.content = event.message;
            fullBuffer = assistant.content;
            streamQueue?.flushNow();
            updateLiveStatus(assistantIdx, "failed");
          }
        },
        "insight",
        conversation.thinkingEffort ?? "off",
      );

      if (gen !== activeStreamGen) return;

      streamQueue?.flushNow();
      disposeStreamQueue();

      setStreaming(false);
      requestId = null;
      activeToolConfirmAbort = null;
      const meta = assistantMeta.get(assistantIdx)!;
      if (streamFailed) {
        meta.status = "failed";
        meta.finishReason = finishReason;
      } else if (meta.status !== "interrupted") {
        meta.status = "completed";
        meta.finishReason = finishReason;
      }
      assistantMeta.set(assistantIdx, meta);

      if (!assistant.content.trim() && !assistant.reasoning?.trim() && !streamFailed) {
        messages.pop();
        assistantMeta.delete(assistantIdx);
      }
      if (conversation) {
        conversation.messages = [...messages];
        if (meta.status === "completed") requestTitleSummarize();
        await persistConversation();
      }
      renderMessages();
      if (meta.finishReason === "length") showLengthHint(assistantIdx);
      if (meta.status === "completed" || meta.status === "interrupted") showLiveActions(assistantIdx);
      if (meta.status === "failed") showLiveActions(assistantIdx, true);
      syncTokenBar();
      input.focus();
    }

    input.addEventListener("focus", () => {
      expanded = true;
      applyTextareaHeight();
    });

    input.addEventListener("input", () => {
      expanded = true;
      applyTextareaHeight();
      syncTokenBar();
      writeComposerDraft(conversationId, input.value);
    });

    input.addEventListener("keydown", (e) => {
      const result = handleInsightComposerKeydown({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        keyCode: e.keyCode,
        value: input.value,
        cursor: input.selectionStart ?? 0,
      });
      if (!result.preventDefault) return;
      e.preventDefault();
      if (result.value !== undefined) {
        input.value = result.value;
        const pos = result.cursor ?? result.value.length;
        input.setSelectionRange(pos, pos);
        applyTextareaHeight();
        syncTokenBar();
        writeComposerDraft(conversationId, input.value);
      }
      if (result.submit) {
        if (streaming && requestId) {
          void stopStreaming();
        } else {
          void sendMessage(input.value);
        }
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (streaming && requestId) {
        void stopStreaming();
        return;
      }
      void sendMessage(input.value);
    });

    plusBtn.addEventListener("click", () => {
      if (streaming) return;
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const picked = fileInput.files;
      if (picked) attachments.push(...Array.from(picked));
      fileInput.value = "";
      renderAttachments();
    });

    attachEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-attach-remove]");
      if (!btn) return;
      const idx = Number(btn.dataset.attachRemove);
      if (!Number.isInteger(idx) || idx < 0 || idx >= attachments.length) return;
      attachments.splice(idx, 1);
      renderAttachments();
    });

    modelBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!conversation) return;
      if (modelMenuPopover?.isOpen()) {
        await modelMenuPopover.close();
        return;
      }
      const popover = createModelMenuPopover();
      await popover.open();
    });

    headingEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      startRename();
    });
    headingEdit.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void commitRename();
      }
    });
    headingEdit.addEventListener("input", () => {
      if (headingEdit.value.trim()) headingEdit.classList.remove("is-invalid");
    });
    headingEdit.addEventListener("blur", () => {
      if (renaming) stopRename(true);
    });

    function onDocumentClick(e: MouseEvent) {
      const target = e.target as Node;
      if (expanded && !form.contains(target)) {
        expanded = false;
        applyTextareaHeight();
      }
    }

    document.addEventListener("click", onDocumentClick);

    function onInsightAbortChat() {
      void stopStreaming();
    }

    window.addEventListener("orbita:insight-abort-chat", onInsightAbortChat);

    timeTick = setInterval(() => {
      messagesEl.querySelectorAll<HTMLButtonElement>('.insight-chat-msg-time[data-rel="1"]').forEach((btn) => {
        btn.textContent = formatMessageRel(btn.dataset.iso ?? "");
      });
      messagesEl.querySelectorAll<HTMLButtonElement>('.insight-chat-msg-time[data-rel="0"]').forEach((btn) => {
        btn.textContent = formatMessageAbs(btn.dataset.iso ?? "");
      });
    }, 30000);

    const handle: InsightDestinationHandle = {
      activate() {
        void initConfig();
        input.focus();
      },
      deactivate() {
        writeComposerDraft(conversationId, input.value);
      },
      getRestoreState() {
        writeComposerDraft(conversationId, input.value);
        return conversationId ? { conversationId } : undefined;
      },
      restoreState(state: unknown) {
        const id = conversationIdFromState(state);
        void (async () => {
          if (id && id !== conversationId) {
            ++titleJobGen;
            writeComposerDraft(conversationId, input.value);
            await stopStreaming();
            conversation = null;
            assistantMeta.clear();
            messages.length = 0;
            initPromise = null;
            input.value = "";
          }
          if (id) conversationId = id;
          await initConfig();
        })();
      },
      getSecondaryRailDescriptor: () => chatRail.getSecondaryRailDescriptor(),
      dispose() {
        ++titleJobGen;
        writeComposerDraft(conversationId, input.value);
        if (timeTick) {
          clearInterval(timeTick);
          timeTick = null;
        }
        chatRail.dispose();
        document.removeEventListener("click", onDocumentClick);
        window.removeEventListener("orbita:insight-abort-chat", onInsightAbortChat);
        modelMenuPopover?.dispose();
        modelMenuPopover = null;
        temperatureSlider?.dispose();
        temperatureSlider = null;
        if (streaming && requestId) {
          void stopStreaming();
        } else {
          disposeStreamQueue();
          if (requestId) {
            void abortChat(requestId);
            requestId = null;
          }
        }
        root.innerHTML = "";
      },
    };
    return handle;
  },
};

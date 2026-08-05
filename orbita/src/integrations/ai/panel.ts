import { mountContextMenu } from "../../ui/context-menu";
import { closePopover, isPopoverOpen, openPopover, type MotionTrigger } from "../../ui/motion";
import { escAttr, escHtml } from "../../core/html";
import { getAiConfig, saveAiConfig, type ApiEntry } from "./config";
import { abortChat, chatStream, generateConversationTitle, type ChatMessage } from "./adapter";
import {
  deleteConversation,
  ensureInitialConversation,
  listConversations,
  loadConversation,
  newConversation,
  saveConversation,
  setActiveConversationId,
  titleFromMessage,
  uniqueConversationTitle,
  type Conversation,
} from "./conversations";
import { AI_SVG, BRAIN_SVG, CHEVRON_SVG, WEB_SVG } from "./icons";
import { mountTextDialog } from "./prompt-dialog";
import { confirmAgentTool } from "./tool-confirm";
import { mountConfirmDialog } from "../shell/dialog";
import { EDIT_SVG } from "../shell/tiles";
import { renderMarkdown } from "./render-markdown";

const PROMPT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/></svg>`;
const DELETE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

const CONV_EXPANDED_MAX = 148;
const CONV_ANIM_MS = 300;
const CONV_CLOSE_MS = 180;

const MODEL_INLINE_MAX = 24;

const THINKING_HTML = `<div class="ai-msg-thinking"><span class="ai-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ai-thinking-label">思考中</span></div>`;

function formatPlainText(text: string) {
  return escHtml(text).replace(/\n/g, "<br>");
}

function formatAssistantHtml(content: string) {
  return `<div class="ai-md">${renderMarkdown(content)}</div>`;
}

function messageBubbleHtml(m: ChatMessage, index: number) {
  const body = m.role === "user" ? formatPlainText(m.content) : formatAssistantHtml(m.content);
  return `<div class="ai-msg ai-msg-${m.role}" data-index="${index}"><div class="ai-msg-bubble">${body}</div></div>`;
}

function modelBaseName(model: string): string {
  return model.includes("/") ? model.split("/").pop()! : model;
}

function displayModelInline(model: string): string {
  const name = modelBaseName(model);
  if (name.length <= MODEL_INLINE_MAX) return name;
  return `${name.slice(0, MODEL_INLINE_MAX - 1)}…`;
}

export function mountAiPanel(root: HTMLElement, dialogRoot: HTMLElement) {
  const aside = document.createElement("aside");
  aside.className = "shell-aside";
  aside.innerHTML = `
    <section class="ai-section">
      <div class="ai-topbar">
        <span class="launcher-title ai-brand">${AI_SVG}AI</span>
        <div class="ai-conv-picker">
          <div class="ai-conv-track" id="aiConvTrack">
            <button type="button" class="ai-conv-select" id="aiConvSelect">
              <span class="ai-conv-label" id="aiConvLabel">新对话</span>
              <span class="ai-conv-chevron">${CHEVRON_SVG}</span>
            </button>
          </div>
          <div class="ai-conv-menu scroll-slim motion-popover" id="aiConvMenu"></div>
        </div>
        <div class="ai-topbar-actions">
          <button type="button" class="ai-icon-btn" id="aiNewConv" data-tip="新对话">+</button>
        </div>
      </div>
      <div class="ai-messages scroll-slim" id="aiMessages"></div>
      <div class="ai-bottom">
        <button type="button" class="ai-prompt-btn" id="aiConvPrompt" data-tip="对话 Prompt">${PROMPT_SVG}</button>
        <form class="ai-composer" id="aiForm">
          <div class="ai-composer-box">
            <div class="ai-composer-tools">
              <button type="button" class="ai-tool-btn" disabled data-tip="推理（即将支持）">${BRAIN_SVG}</button>
              <button type="button" class="ai-tool-btn" disabled data-tip="联网（即将支持）">${WEB_SVG}</button>
            </div>
            <input type="text" id="aiInput" placeholder="输入消息…" autocomplete="off">
            <button type="button" class="ai-model-btn" id="aiModelBtn">模型</button>
          </div>
          <button type="submit" class="ai-send-btn" id="aiSendBtn">发送</button>
        </form>
        <div class="ai-model-menu scroll-slim motion-popover" id="aiModelMenu"></div>
      </div>
    </section>
  `;
  root.appendChild(aside);

  const convPicker = aside.querySelector<HTMLElement>(".ai-conv-picker")!;
  const convTrack = aside.querySelector<HTMLElement>("#aiConvTrack")!;
  const convLabel = aside.querySelector<HTMLElement>("#aiConvLabel")!;
  const convSelect = aside.querySelector<HTMLButtonElement>("#aiConvSelect")!;
  const convMenu = aside.querySelector<HTMLElement>("#aiConvMenu")!;
  const messagesEl = aside.querySelector<HTMLElement>("#aiMessages")!;
  const form = aside.querySelector<HTMLFormElement>("#aiForm")!;
  const input = aside.querySelector<HTMLInputElement>("#aiInput")!;
  const sendBtn = aside.querySelector<HTMLButtonElement>("#aiSendBtn")!;
  const modelBtn = aside.querySelector<HTMLButtonElement>("#aiModelBtn")!;
  const modelMenu = aside.querySelector<HTMLElement>("#aiModelMenu")!;

  const promptDialog = mountTextDialog(dialogRoot);
  const confirmDelete = mountConfirmDialog(dialogRoot);
  const msgCtxMenu = mountContextMenu(new AbortController().signal);
  let conversation: Conversation | null = null;
  let requestId: string | null = null;
  let streaming = false;
  let activeStreamGen = 0;
  let modelMenuEntryId: string | null = null;

  let streamingBubble: HTMLElement | null = null;
  let streamingTextEl: HTMLElement | null = null;
  let streamingToolsEl: HTMLElement | null = null;
  let toolStepCounter = 0;
  let lastPendingStepId = 0;
  let streamHasText = false;
  let messagesScrollHeight = 0;

  function scrollMessagesToEnd() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    messagesScrollHeight = messagesEl.scrollHeight;
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

  function prepStreamingBubble(thinking = true) {
    ensureStreamingBubble();
    if (!streamingBubble) return;
    if (!streamingBubble.querySelector(".ai-msg-text")) {
      streamingBubble.innerHTML = `<div class="ai-msg-text${thinking ? " is-thinking" : " is-stream-plain"}">${thinking ? THINKING_HTML : ""}</div>`;
      streamingToolsEl = null;
      streamingTextEl = streamingBubble.querySelector<HTMLElement>(".ai-msg-text")!;
      streamHasText = false;
    }
  }

  function ensureToolStepsEl() {
    ensureStreamingBubble();
    if (!streamingBubble) return null;
    if (streamingToolsEl) return streamingToolsEl;
    streamingToolsEl = streamingBubble.querySelector<HTMLElement>(".ai-tool-steps");
    if (!streamingToolsEl) {
      streamingToolsEl = document.createElement("div");
      streamingToolsEl.className = "ai-tool-steps";
      const textEl = streamingBubble.querySelector(".ai-msg-text");
      if (textEl) streamingBubble.insertBefore(streamingToolsEl, textEl);
      else streamingBubble.appendChild(streamingToolsEl);
    }
    return streamingToolsEl;
  }

  function paintStreamingPlainText(content: string) {
    prepStreamingBubble(false);
    if (!streamingTextEl) return;
    if (!streamHasText) {
      streamingTextEl.classList.remove("is-thinking");
      streamingTextEl.classList.add("is-stream-plain");
      streamHasText = true;
    }
    streamingTextEl.textContent = content;
    scrollMessagesIfPinned();
  }

  function pushStreamingChunk(_delta: string, content: string) {
    paintStreamingPlainText(content);
  }

  function resetStreamingRefs() {
    streamingBubble = null;
    streamingTextEl = null;
    streamingToolsEl = null;
    streamHasText = false;
  }

  function ensureStreamingBubble() {
    if (!streamingBubble) {
      const msg = messagesEl.querySelector<HTMLElement>(".ai-msg-assistant:last-of-type");
      streamingBubble = msg?.querySelector<HTMLElement>(".ai-msg-bubble") ?? null;
    }
    if (!streamingBubble) return;
    streamingToolsEl = streamingBubble.querySelector<HTMLElement>(".ai-tool-steps") ?? null;
    streamingTextEl = streamingBubble.querySelector<HTMLElement>(".ai-msg-text");
  }

  function renderMessages() {
    if (!conversation) return;
    resetStreamingRefs();
    messagesEl.innerHTML = conversation.messages.map((m, i) => messageBubbleHtml(m, i)).join("");
    syncMessagesScrollHeight();
    if (isMessagesPinned()) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendToolStep(name: string, label: string, pending = false) {
    if (!streamHasText) prepStreamingBubble(true);
    const toolsEl = ensureToolStepsEl();
    if (!toolsEl) return;
    const id = ++toolStepCounter;
    lastPendingStepId = id;
    const row = document.createElement("div");
    row.className = "ai-tool-step is-pending";
    row.dataset.stepId = String(id);
    row.dataset.toolName = name;
    const badge = pending ? "待确认" : "执行中";
    row.innerHTML = `<span class="ai-tool-step-badge">${badge}</span><span class="ai-tool-step-text">${escHtml(label)}</span>`;
    toolsEl.appendChild(row);
    scrollMessagesIfPinned();
  }

  function promotePendingToolStep(name: string, label: string) {
    ensureStreamingBubble();
    if (!streamingToolsEl) return;
    const row = streamingToolsEl.querySelector<HTMLElement>(`[data-tool-name="${name}"].is-pending`);
    if (!row) return;
    const badge = row.querySelector(".ai-tool-step-badge");
    if (badge) badge.textContent = "执行中";
    const text = row.querySelector(".ai-tool-step-text");
    if (text) text.textContent = label;
    lastPendingStepId = Number(row.dataset.stepId);
    scrollMessagesIfPinned();
  }

  function appendOrStartToolStep(name: string, label: string) {
    ensureStreamingBubble();
    if (!streamingToolsEl) return;
    const row = streamingToolsEl.querySelector<HTMLElement>(`[data-tool-name="${name}"].is-pending`);
    if (row) {
      promotePendingToolStep(name, label);
      return;
    }
    appendToolStep(name, label);
  }

  function clearThinkingUi() {
    ensureStreamingBubble();
    if (!streamingTextEl || streamHasText) return;
    streamingTextEl.classList.remove("is-thinking");
    streamingTextEl.classList.add("is-stream-plain");
    streamingTextEl.textContent = "";
  }

  function finishToolStep(name: string, ok: boolean, summary: string) {
    ensureStreamingBubble();
    if (!streamingToolsEl) {
      if (!ok) clearThinkingUi();
      return;
    }
    const row =
      streamingToolsEl.querySelector<HTMLElement>(`[data-step-id="${lastPendingStepId}"]`) ??
      streamingToolsEl.querySelector<HTMLElement>(".ai-tool-step.is-pending:last-child");
    if (row) {
      row.classList.remove("is-pending");
      row.classList.toggle("is-done", ok);
      row.classList.toggle("is-error", !ok);
      const badge = ok ? "完成" : "失败";
      row.innerHTML = `<span class="ai-tool-step-badge">${badge}</span><span class="ai-tool-step-text">${escHtml(summary)}</span>`;
    }
    if (ok && name.startsWith("ticktick_")) {
      window.dispatchEvent(new CustomEvent("orbita:ticktick-refresh"));
    }
    if (ok && (name.startsWith("journal_") || name === "garmin_sync")) {
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
    }
    if (!ok) clearThinkingUi();
    scrollMessagesIfPinned();
  }

  let convAnimating = false;

  function setConvWidth(px: number) {
    convTrack.style.width = `${px}px`;
    convPicker.style.width = `${px}px`;
  }

  function setConvAnimMode(mode: "expand" | "collapse" | null) {
    convPicker.classList.remove("is-expanding", "is-collapsing");
    if (mode === "expand") convPicker.classList.add("is-expanding");
    if (mode === "collapse") convPicker.classList.add("is-collapsing");
  }

  function waitWidthTransition(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        convTrack.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (ev: TransitionEvent) => {
        if (ev.target !== convTrack || ev.propertyName !== "width") return;
        finish();
      };
      convTrack.addEventListener("transitionend", onEnd);
      window.setTimeout(finish, ms);
    });
  }

  async function animateConvWidth(targetW: number, mode: "expand" | "collapse") {
    setConvAnimMode(mode);
    convAnimating = true;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    setConvWidth(targetW);
    await waitWidthTransition(mode === "expand" ? CONV_ANIM_MS : CONV_CLOSE_MS);
    setConvAnimMode(null);
    convAnimating = false;
  }

  function measureLabelWidth(): number {
    convSelect.style.width = "max-content";
    const w = Math.min(Math.ceil(convSelect.offsetWidth), CONV_EXPANDED_MAX);
    convSelect.style.width = "";
    return w;
  }

  function measureMenuIntrinsicWidth(): number {
    const prev = convMenu.style.cssText;
    Object.assign(convMenu.style, {
      position: "absolute",
      visibility: "hidden",
      width: "max-content",
      maxHeight: "none",
      opacity: "1",
      pointerEvents: "none",
      transform: "none",
    });
    const w = Math.ceil(convMenu.offsetWidth);
    convMenu.style.cssText = prev;
    return w;
  }

  function measureConvCollapsedWidth() {
    convPicker.classList.remove("is-expanded");
    convMenu.classList.remove("is-open");
    convTrack.style.width = "auto";
    convPicker.style.width = "auto";
    const w = measureLabelWidth();
    setConvWidth(w);
    return w;
  }

  function syncConvPickerWidth() {
    if (convPicker.classList.contains("is-expanded")) return;
    measureConvCollapsedWidth();
  }

  async function closeConvPicker(instant = false) {
    if (!isPopoverOpen(convMenu) && !convPicker.classList.contains("is-expanded")) return;
    if (convAnimating && !instant) return;
    if (instant) {
      void closePopover(convMenu);
      if (!convPicker.classList.contains("is-expanded")) return;
      setConvAnimMode(null);
      convAnimating = false;
      setConvWidth(measureLabelWidth());
      convPicker.classList.remove("is-expanded");
      measureConvCollapsedWidth();
      return;
    }
    if (isPopoverOpen(convMenu)) {
      await closePopover(convMenu);
    }
    if (!convPicker.classList.contains("is-expanded")) return;
    const targetW = measureLabelWidth();
    await animateConvWidth(targetW, "collapse");
    convPicker.classList.remove("is-expanded");
    measureConvCollapsedWidth();
  }

  function finishConvOpen(trigger: MotionTrigger) {
    void openPopover(convMenu, trigger);
  }

  async function openConvPicker(trigger: MotionTrigger) {
    if (isPopoverOpen(convMenu)) {
      void closeConvPicker();
      return;
    }
    if (convAnimating) return;
    const collapsedW = measureConvCollapsedWidth();
    await paintConvMenu();
    const expandedW = Math.min(
      CONV_EXPANDED_MAX,
      Math.max(collapsedW, measureMenuIntrinsicWidth()),
    );
    convPicker.classList.add("is-expanded");
    if (expandedW - collapsedW < 2) {
      setConvWidth(expandedW);
      finishConvOpen(trigger);
      return;
    }
    await animateConvWidth(expandedW, "expand");
    finishConvOpen(trigger);
  }

  function syncConvLabel() {
    if (!conversation) return;
    convLabel.textContent = conversation.title;
    syncConvPickerWidth();
  }

  async function paintConvMenu() {
    const list = await listConversations();
    convMenu.innerHTML = list
      .map(
        (c) => `
          <div class="ai-conv-row ${conversation?.id === c.id ? "active" : ""}" data-id="${escAttr(c.id)}">
            <button type="button" class="ai-conv-item" data-id="${escAttr(c.id)}">${escHtml(c.title)}</button>
            <div class="ai-conv-row-actions">
              <button type="button" class="ai-conv-action" data-action="edit" data-id="${escAttr(c.id)}" data-tip="重命名">${EDIT_SVG}</button>
              <button type="button" class="ai-conv-action" data-action="delete" data-id="${escAttr(c.id)}" data-tip="删除">${DELETE_SVG}</button>
            </div>
          </div>
        `,
      )
      .join("");
  }

  async function renameConversation(id: string, trigger: HTMLElement) {
    const conv = await loadConversation(id);
    const next = await promptDialog("重命名对话", conv.title, trigger);
    if (next === null) return;
    const title = next.trim();
    if (!title) return;
    conv.title = await uniqueConversationTitle(title, id);
    await saveConversation(conv);
    if (conversation?.id === id) {
      conversation.title = conv.title;
      syncConvLabel();
    }
    await paintConvMenu();
  }

  async function removeConversation(id: string, title: string, trigger: HTMLElement) {
    if (!(await confirmDelete("删除确认", `确定删除「${title}」？`, trigger))) return;
    await deleteConversation(id);
    const list = await listConversations();
    if (conversation?.id === id) {
      if (list.length > 0) {
        await switchConversation(list[0].id);
        return;
      }
      await createNewConversation();
      return;
    }
    await paintConvMenu();
  }

  function syncModelBtn() {
    if (!conversation) return;
    modelBtn.textContent = displayModelInline(conversation.activeModel);
    modelBtn.removeAttribute("title");
    modelBtn.dataset.tip = "当前模型";
  }

  function paintModelMenu() {
    if (!conversation) return;
    const config = getAiConfig();
    const previewEntryId = modelMenuEntryId ?? conversation.activeEntryId;
    const entry = config.entries.find((e) => e.id === previewEntryId) ?? config.entries[0];
    const activeModel =
      entry?.id === conversation.activeEntryId ? conversation.activeModel : entry?.models[0] ?? "";
    modelMenu.innerHTML = `
      <div class="ai-model-picker-head">选择模型</div>
      <div class="ai-model-picker-body">
        <div class="ai-model-picker-col">
          <div class="ai-model-picker-label">API</div>
          <div class="ai-model-picker-apis">
            ${config.entries
              .map(
                (e) =>
                  `<button type="button" class="ai-model-api ${e.id === previewEntryId ? "active" : ""}" data-entry="${e.id}">${escHtml(e.name)}</button>`,
              )
              .join("")}
          </div>
        </div>
        <div class="ai-model-picker-col">
          <div class="ai-model-picker-label">模型</div>
          <div class="ai-model-picker-models">
            ${entry?.models
              .map(
                (m) =>
                  `<button type="button" class="ai-model-choice ${m === activeModel ? "active" : ""}" data-model="${escapeAttr(m)}">${escHtml(modelBaseName(m))}</button>`,
              )
              .join("") ?? `<div class="ai-model-picker-empty">暂无模型</div>`}
          </div>
        </div>
      </div>
    `;
  }

  function escapeAttr(value: string) {
    return escAttr(value);
  }

  function setStreaming(active: boolean) {
    streaming = active;
    input.disabled = active;
    sendBtn.textContent = active ? "停止" : "发送";
    sendBtn.classList.toggle("is-stop", active);
  }

  async function stopStreaming() {
    if (!streaming || !requestId) return;
    activeStreamGen++;
    const id = requestId;
    requestId = null;
    setStreaming(false);
    void abortChat(id);
    resetStreamingRefs();
    if (conversation) {
      const last = conversation.messages[conversation.messages.length - 1];
      if (last?.role === "assistant" && !last.content.trim()) {
        conversation.messages.pop();
      } else {
        await persistConversation();
      }
    }
    renderMessages();
    input.focus();
  }

  function buildApiMessages(conv: Conversation): ChatMessage[] {
    const config = getAiConfig();
    const system = conv.conversationPrompt.trim() || config.defaultPrompt.trim();
    const msgs: ChatMessage[] = [];
    if (system) msgs.push({ role: "system", content: system });
    msgs.push(...conv.messages);
    return msgs;
  }

  async function switchConversation(id: string) {
    if (streaming) return;
    void closeConvPicker(true);
    conversation = await loadConversation(id);
    setActiveConversationId(id);
    syncConvLabel();
    renderMessages();
    syncModelBtn();
    await paintConvMenu();
  }

  async function persistConversation() {
    if (!conversation) return;
    await saveConversation(conversation);
    syncConvLabel();
    await paintConvMenu();
  }

  async function copyMessageAt(index: number) {
    if (!conversation) return;
    const text = conversation.messages[index]?.content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  async function deleteMessageAt(index: number) {
    if (!conversation || streaming) return;
    if (index < 0 || index >= conversation.messages.length) return;
    conversation.messages.splice(index, 1);
    if (conversation.messages.length === 0) {
      conversation.title = await uniqueConversationTitle("新对话");
    }
    await persistConversation();
    renderMessages();
  }

  async function refreshAiTitle(
    userMsg: string,
    assistantMsg: string,
    entry: ApiEntry,
    model: string,
  ) {
    if (!conversation) return;
    try {
      const title = await generateConversationTitle(userMsg, assistantMsg, entry, model);
      if (!title.trim()) return;
      conversation.title = await uniqueConversationTitle(title.trim(), conversation.id);
      await saveConversation(conversation);
      syncConvLabel();
      await paintConvMenu();
    } catch {
      /* keep provisional title */
    }
  }

  async function sendMessage(text: string) {
    if (!conversation) return;
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    const isFirstRound = conversation.messages.length === 0;
    if (isFirstRound) {
      const base = titleFromMessage(trimmed);
      conversation.title = await uniqueConversationTitle(base, conversation.id);
    }

    conversation.messages.push({ role: "user", content: trimmed });
    renderMessages();
    input.value = "";

    const assistant: ChatMessage = { role: "assistant", content: "" };
    conversation.messages.push(assistant);
    renderMessages();
    prepStreamingBubble();
    scrollMessagesToEnd();

    const config = getAiConfig();
    const entry = config.entries.find((e) => e.id === conversation!.activeEntryId) ?? config.entries[0];
    if (!entry) {
      assistant.content = "请先在 AI 设置中添加 API";
      renderMessages();
      await persistConversation();
      return;
    }

    requestId = crypto.randomUUID();
    const gen = ++activeStreamGen;
    setStreaming(true);

    await chatStream(
      requestId,
      buildApiMessages({
        ...conversation,
        messages: conversation.messages.slice(0, -1),
      }),
      entry,
      conversation.activeModel,
      (event) => {
        if (gen !== activeStreamGen) return;
        if (event.type === "chunk") {
          const delta = event.content;
          assistant.content += delta;
          pushStreamingChunk(delta, assistant.content);
        } else if (event.type === "toolConfirm") {
          appendToolStep(event.name, event.label, true);
          void (async () => {
            try {
              const ok = await confirmAgentTool(dialogRoot, {
                confirmId: event.confirmId,
                confirm_id: event.confirm_id,
                name: event.name,
                label: event.label,
                args: event.args,
              });
              if (!ok) {
                finishToolStep(event.name, false, "已取消");
              } else {
                promotePendingToolStep(event.name, event.label);
              }
            } catch (e) {
              finishToolStep(event.name, false, String(e));
            }
          })();
        } else if (event.type === "toolStart") {
          appendOrStartToolStep(event.name, event.label);
        } else if (event.type === "toolDone") {
          finishToolStep(event.name, event.ok, event.summary);
        } else if (event.type === "error") {
          assistant.content = event.message;
          paintStreamingPlainText(assistant.content);
        }
      },
    );

    if (gen !== activeStreamGen) return;

    setStreaming(false);
    requestId = null;
    if (!assistant.content) {
      conversation.messages.pop();
    }
    resetStreamingRefs();
    await persistConversation();
    renderMessages();
    if (isFirstRound && assistant.content.trim() && entry) {
      void refreshAiTitle(trimmed, assistant.content, entry, conversation.activeModel);
    }
    input.focus();
  }

  async function createNewConversation() {
    if (streaming) return;
    const config = getAiConfig();
    conversation = newConversation(config);
    conversation.title = await uniqueConversationTitle("新对话");
    await saveConversation(conversation);
    setActiveConversationId(conversation.id);
    syncConvLabel();
    renderMessages();
    syncModelBtn();
    void closeConvPicker();
    await paintConvMenu();
    input.focus();
  }

  function refreshUi() {
    syncModelBtn();
    paintModelMenu();
  }

  window.addEventListener("orbita:ai-config", refreshUi);

  convSelect.addEventListener("click", (e) => {
    e.stopPropagation();
    void openConvPicker(e);
  });

  convMenu.addEventListener("click", (e) => {
    const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ai-conv-action");
    if (actionBtn?.dataset.id) {
      e.stopPropagation();
      const id = actionBtn.dataset.id;
      const row = actionBtn.closest<HTMLElement>(".ai-conv-row");
      const title = row?.querySelector<HTMLElement>(".ai-conv-item")?.textContent ?? "";
      if (actionBtn.dataset.action === "edit") void renameConversation(id, actionBtn);
      else if (actionBtn.dataset.action === "delete") void removeConversation(id, title, actionBtn);
      return;
    }
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ai-conv-item");
    if (!btn?.dataset.id) return;
    void switchConversation(btn.dataset.id);
  });

  aside.querySelector("#aiNewConv")!.addEventListener("click", () => void createNewConversation());

  aside.querySelector("#aiConvPrompt")!.addEventListener("click", async (e) => {
    if (!conversation) return;
    const next = await promptDialog("对话 Prompt", conversation.conversationPrompt, e.currentTarget as HTMLElement);
    if (next === null) return;
    conversation.conversationPrompt = next;
    await persistConversation();
  });

  modelBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!conversation) return;
    modelMenuEntryId = conversation.activeEntryId;
    paintModelMenu();
    if (isPopoverOpen(modelMenu)) {
      await closePopover(modelMenu, e);
      modelMenuEntryId = null;
      return;
    }
    await openPopover(modelMenu, e);
  });

  modelMenu.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!conversation) return;
    const entryBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ai-model-api");
    if (entryBtn?.dataset.entry) {
      modelMenuEntryId = entryBtn.dataset.entry;
      paintModelMenu();
      return;
    }
    const modelItem = (e.target as HTMLElement).closest<HTMLButtonElement>(".ai-model-choice");
    if (modelItem?.dataset.model) {
      const entryId = modelMenuEntryId ?? conversation.activeEntryId;
      conversation.activeEntryId = entryId;
      conversation.activeModel = modelItem.dataset.model;
      const config = getAiConfig();
      await saveAiConfig({ ...config, activeEntryId: conversation.activeEntryId, activeModel: conversation.activeModel });
      modelMenuEntryId = null;
      await closePopover(modelMenu);
      syncModelBtn();
      await persistConversation();
    }
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (isPopoverOpen(convMenu) && !aside.querySelector(".ai-conv-picker")?.contains(target)) {
      void closeConvPicker();
    }
    if (
      isPopoverOpen(modelMenu) &&
      !modelMenu.contains(target) &&
      !modelBtn.contains(target)
    ) {
      modelMenuEntryId = null;
      void closePopover(modelMenu);
    }
  });

  messagesEl.addEventListener("contextmenu", (e) => {
    const msgEl = (e.target as HTMLElement).closest<HTMLElement>(".ai-msg");
    if (!msgEl || !messagesEl.contains(msgEl)) return;
    const index = Number(msgEl.dataset.index);
    if (!conversation || Number.isNaN(index) || index < 0 || index >= conversation.messages.length) return;
    e.preventDefault();
    e.stopPropagation();
    msgCtxMenu.show(
      e.clientX,
      e.clientY,
      [
        { action: "copy", label: "复制" },
        { action: "delete", label: "删除", danger: true, confirm: true },
      ],
      (action) => {
        if (action === "copy") void copyMessageAt(index);
        if (action === "delete") void deleteMessageAt(index);
      },
    );
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming && requestId) {
      void stopStreaming();
      return;
    }
    void sendMessage(input.value);
  });

  ensureInitialConversation().then((conv) => {
    conversation = conv;
    syncConvLabel();
    renderMessages();
    syncModelBtn();
    void paintConvMenu();
  });

  return { refreshUi };
}

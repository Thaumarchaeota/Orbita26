import { closePopover, isPopoverOpen, openPopover, type MotionTrigger } from "../../ui/motion";
import { escAttr, escHtml } from "../../core/html";
import { getAiConfig, saveAiConfig } from "./config";
import { abortChat, chatStream, type ChatMessage } from "./adapter";
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
import { mountConfirmDialog } from "../shell/dialog";
import { EDIT_SVG } from "../shell/tiles";

const PROMPT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/></svg>`;
const DELETE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

const CONV_EXPANDED_MAX = 148;
const CONV_ANIM_MS = 300;
const CONV_CLOSE_MS = 180;

const MODEL_INLINE_MAX = 24;

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
  let conversation: Conversation | null = null;
  let requestId: string | null = null;
  let streaming = false;
  let modelMenuEntryId: string | null = null;

  function escapeHtml(text: string) {
    return escHtml(text).replace(/\n/g, "<br>");
  }

  let streamingBubble: HTMLElement | null = null;

  function renderMessages() {
    if (!conversation) return;
    streamingBubble = null;
    messagesEl.innerHTML = conversation.messages
      .map(
        (m) =>
          `<div class="ai-msg ai-msg-${m.role}"><div class="ai-msg-bubble">${escapeHtml(m.content)}</div></div>`,
      )
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateStreamingBubble(content: string) {
    if (!streamingBubble) {
      const bubbles = messagesEl.querySelectorAll<HTMLElement>(".ai-msg-bubble");
      streamingBubble = bubbles[bubbles.length - 1] ?? null;
    }
    if (!streamingBubble) {
      renderMessages();
      return;
    }
    streamingBubble.innerHTML = escapeHtml(content);
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
            <button type="button" class="ai-conv-item" data-id="${escAttr(c.id)}">${escapeHtml(c.title)}</button>
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
                  `<button type="button" class="ai-model-api ${e.id === previewEntryId ? "active" : ""}" data-entry="${e.id}">${escapeHtml(e.name)}</button>`,
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
                  `<button type="button" class="ai-model-choice ${m === activeModel ? "active" : ""}" data-model="${escapeAttr(m)}">${escapeHtml(modelBaseName(m))}</button>`,
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

  async function sendMessage(text: string) {
    if (!conversation) return;
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    if (conversation.messages.length === 0) {
      const base = titleFromMessage(trimmed);
      conversation.title = await uniqueConversationTitle(base, conversation.id);
    }

    conversation.messages.push({ role: "user", content: trimmed });
    renderMessages();
    input.value = "";

    const assistant: ChatMessage = { role: "assistant", content: "" };
    conversation.messages.push(assistant);
    renderMessages();

    const config = getAiConfig();
    const entry = config.entries.find((e) => e.id === conversation!.activeEntryId) ?? config.entries[0];
    if (!entry) {
      assistant.content = "请先在 AI 设置中添加 API";
      renderMessages();
      await persistConversation();
      return;
    }

    requestId = crypto.randomUUID();
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
        if (event.type === "chunk") {
          assistant.content += event.content;
          updateStreamingBubble(assistant.content);
        } else if (event.type === "error") {
          assistant.content = event.message;
          updateStreamingBubble(assistant.content);
        }
      },
    );

    setStreaming(false);
    requestId = null;
    if (!assistant.content) {
      conversation.messages.pop();
    }
    await persistConversation();
    renderMessages();
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

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming && requestId) {
      void abortChat(requestId);
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

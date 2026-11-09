import { escAttr, escHtml } from "../../../core/html";
import { showCommandMenuAt } from "../../../ui/command-menu-popover";
import type { FlatSelectOption, FlatSelectPopoverHandle } from "../../../ui/flat-select-popover";
import { getConfirmDialog } from "../../shell/dialog";
import { attachIdentityDragSource } from "../tab-host/drag-session";
import { openInsightContentTab } from "../tab-host/host-api";
import type { RailDescriptor } from "../secondary-rail";
import type { InsightHostContext } from "../types";
import {
  deleteInsightConversation,
  listInsightConversations,
  type ConversationMeta,
} from "../../ai/conversations";

export {
  INSIGHT_CHAT_RAIL_TOGGLE_EVENT,
  INSIGHT_SECONDARY_RAIL_TOGGLE_EVENT,
  insightChatRailCollapsed,
  setInsightChatRailCollapsed,
} from "../secondary-rail";

const INSIGHT_CHAT_SCRATCH_KEY = "orbita.insight.chat.scratchId";

const CHAT_CONVERSATION_MENU: FlatSelectOption[] = [
  { value: "open", label: "打开" },
  { value: "open-new-tab", label: "在新标签页中打开" },
  { value: "pin", label: "置顶" },
  { value: "rename", label: "重命名" },
  { value: "copy", label: "复制" },
  { value: "archive", label: "归档" },
  { value: "delete", label: "删除", danger: true },
];

export type ChatRailHandle = {
  setActive: (conversationId: string | null) => void;
  refresh: () => void;
  getSecondaryRailDescriptor: () => RailDescriptor;
  dispose: () => void;
};

function convId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
}

export function insightChatScratchId(): string {
  try {
    const existing = localStorage.getItem(INSIGHT_CHAT_SCRATCH_KEY);
    if (existing) return existing;
    const id = convId();
    localStorage.setItem(INSIGHT_CHAT_SCRATCH_KEY, id);
    return id;
  } catch {
    return convId();
  }
}

export function releaseInsightChatScratch(id: string) {
  try {
    if (localStorage.getItem(INSIGHT_CHAT_SCRATCH_KEY) === id) {
      localStorage.removeItem(INSIGHT_CHAT_SCRATCH_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function mountChatRail(page: HTMLElement, ctx: InsightHostContext): ChatRailHandle {
  let activeId: string | null = null;
  let items: ConversationMeta[] = [];
  let listHost: HTMLElement | null = null;
  let contextMenu: FlatSelectPopoverHandle | null = null;

  function releaseContextMenu(): void {
    contextMenu?.dispose();
    contextMenu = null;
  }

  function openConversation(id: string): void {
    const meta = items.find((c) => c.id === id);
    openInsightContentTab({ kind: "chat", id }, meta?.title);
  }

  async function deleteConversationById(id: string): Promise<void> {
    const wasActive = activeId === id;
    await deleteInsightConversation(id);
    window.dispatchEvent(new CustomEvent("orbita:insight-conversation-deleted", { detail: { id } }));
    await paint();
    if (!wasActive) return;
    const next = items[0];
    if (next) openInsightContentTab({ kind: "chat", id: next.id }, next.title);
    else openInsightContentTab({ kind: "chat", id: insightChatScratchId() }, "新对话");
  }

  async function paint() {
    if (!listHost) return;
    items = await listInsightConversations();
    listHost.innerHTML = items
      .map(
        (c) =>
          `<div class="insight-chat-rail-row">
            <button type="button" class="insight-chat-rail-item${c.id === activeId ? " is-active" : ""}" data-id="${escAttr(c.id)}" title="${escAttr(c.title)}">${escHtml(c.title)}</button>
          </div>`,
      )
      .join("");
    listHost.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((btn) => {
      if (btn.dataset.dragWired) return;
      btn.dataset.dragWired = "1";
      attachIdentityDragSource(btn, () => {
        const id = btn.dataset.id;
        if (!id) return null;
        const conv = items.find((c) => c.id === id);
        return { identity: { kind: "chat", id }, title: conv?.title ?? "对话" };
      });
    });
  }

  function getSecondaryRailDescriptor(): RailDescriptor {
    return {
      kind: "chat",
      title: "对话列表",
      selectedKey: activeId ?? "",
      onSelect: (key) => {
        openConversation(key);
      },
      onCreate: () => {
        openInsightContentTab({ kind: "chat", id: insightChatScratchId() }, "新对话");
      },
      renderContent(host) {
        listHost = host;
        host.addEventListener("click", onListClick);
        host.addEventListener("contextmenu", onListContextMenu);
        void paint();
        return () => {
          host.removeEventListener("click", onListClick);
          host.removeEventListener("contextmenu", onListContextMenu);
          host.innerHTML = "";
          listHost = null;
        };
      },
    };
  }

  function onListContextMenu(e: MouseEvent) {
    const row = (e.target as HTMLElement).closest(".insight-chat-rail-row");
    const trigger = row?.querySelector<HTMLButtonElement>("button[data-id]");
    const id = trigger?.dataset.id;
    if (!id || !trigger) return;
    e.preventDefault();
    releaseContextMenu();
    contextMenu = showCommandMenuAt(e.clientX, e.clientY, CHAT_CONVERSATION_MENU, (action) => {
      switch (action) {
        case "open":
          openConversation(id);
          break;
        case "open-new-tab":
          openConversation(id);
          break;
        case "delete":
          void (async () => {
            const ok = await getConfirmDialog()("删除对话", "删除后无法恢复。", trigger, {
              confirmLabel: "删除",
              danger: true,
            });
            if (!ok) return;
            await deleteConversationById(id);
          })();
          break;
        case "pin":
        case "rename":
        case "copy":
        case "archive":
          break;
        default:
          break;
      }
    }, {
      returnFocus: trigger,
      onClose: () => {
        contextMenu = null;
      },
    });
  }

  function onListClick(e: Event) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
    if (!btn?.dataset.id) return;
    getSecondaryRailDescriptor().onSelect(btn.dataset.id);
  }

  const onChanged = () => {
    void paint();
  };
  window.addEventListener("orbita:insight-conversations-changed", onChanged);

  return {
    setActive(conversationId) {
      activeId = conversationId;
      void paint();
    },
    refresh() {
      void paint();
    },
    getSecondaryRailDescriptor,
    dispose() {
      releaseContextMenu();
      window.removeEventListener("orbita:insight-conversations-changed", onChanged);
      listHost = null;
    },
  };
}

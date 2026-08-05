import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { getSettings, patchSettings } from "../../core/settings";
import { defaultAiConfig, getAiConfig, type AiConfig } from "./config";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  title: string;
  conversationPrompt: string;
  messages: ChatMessage[];
  activeEntryId: string;
  activeModel: string;
  updatedAt: string;
};

const WEB_CONV_KEY = "orbita.data.ai.conversations";

function readWebConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(WEB_CONV_KEY);
    if (raw) return JSON.parse(raw) as Conversation[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeWebConversations(conversations: Conversation[]) {
  localStorage.setItem(WEB_CONV_KEY, JSON.stringify(conversations));
}

function nowIso() {
  return new Date().toISOString();
}

export function newConversation(config?: AiConfig): Conversation {
  const ai = config ?? getAiConfig();
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    conversationPrompt: "",
    messages: [],
    activeEntryId: ai.activeEntryId,
    activeModel: ai.activeModel,
    updatedAt: nowIso(),
  };
}

export async function listConversations(): Promise<ConversationMeta[]> {
  if (isTauri()) {
    return invoke<ConversationMeta[]>("list_ai_conversations");
  }
  return readWebConversations()
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadConversation(id: string): Promise<Conversation> {
  if (isTauri()) {
    return invoke<Conversation>("read_ai_conversation", { id });
  }
  const found = readWebConversations().find((c) => c.id === id);
  if (!found) throw new Error("conversation not found");
  return found;
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = nowIso();
  if (isTauri()) {
    await invoke("write_ai_conversation", { conversation });
    return;
  }
  const all = readWebConversations();
  const idx = all.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) all[idx] = conversation;
  else all.push(conversation);
  writeWebConversations(all);
}

export async function deleteConversation(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_ai_conversation", { id });
    return;
  }
  writeWebConversations(readWebConversations().filter((c) => c.id !== id));
}

export function getActiveConversationId(): string | null {
  try {
    return getSettings().ui.activeConversationId;
  } catch {
    return null;
  }
}

export function setActiveConversationId(id: string) {
  void patchSettings({
    ui: { ...getSettings().ui, activeConversationId: id },
  });
}

export async function ensureInitialConversation(): Promise<Conversation> {
  const list = await listConversations();
  const savedId = getActiveConversationId();
  if (savedId) {
    try {
      return await loadConversation(savedId);
    } catch {
      /* fall through */
    }
  }
  if (list.length > 0) {
    const conv = await loadConversation(list[0].id);
    setActiveConversationId(conv.id);
    return conv;
  }
  const conv = newConversation(defaultAiConfig());
  conv.title = await uniqueConversationTitle("新对话");
  await saveConversation(conv);
  setActiveConversationId(conv.id);
  return conv;
}

export function titleFromMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return "新对话";
  return t.length > 8 ? `${t.slice(0, 8)}…` : t;
}

export async function uniqueConversationTitle(base: string, excludeId?: string): Promise<string> {
  const list = await listConversations();
  const used = new Set(list.filter((c) => c.id !== excludeId).map((c) => c.title));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

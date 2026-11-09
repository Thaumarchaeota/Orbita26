import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { getSettings, patchSettings } from "../../core/settings";
import { defaultAiConfig, getAiConfig, type AiConfig } from "./config";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  createdAt?: string;
  sources?: { title: string; url: string }[];
  searchStatus?: string;
};

export type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: string;
};

export type ThinkingEffort = "off" | "low" | "medium" | "high";

export type Conversation = {
  id: string;
  title: string;
  conversationPrompt: string;
  messages: ChatMessage[];
  activeEntryId: string;
  activeModel: string;
  updatedAt: string;
  titleLocked?: boolean;
  thinkingEffort?: ThinkingEffort;
};

const WEB_CONV_LEGACY = "orbita.data.ai.conversations";

function webConvKey(): string {
  try {
    const dir = getSettings().dataDir.trim() || "orbita-data";
    return `orbita.data.stores.${dir}.ai.conversations`;
  } catch {
    return WEB_CONV_LEGACY;
  }
}

function readWebConversations(): Conversation[] {
  try {
    const key = webConvKey();
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Conversation[];
    if (key !== WEB_CONV_LEGACY) {
      const legacy = localStorage.getItem(WEB_CONV_LEGACY);
      if (legacy) {
        localStorage.setItem(key, legacy);
        return JSON.parse(legacy) as Conversation[];
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeWebConversations(conversations: Conversation[]) {
  localStorage.setItem(webConvKey(), JSON.stringify(conversations));
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
    thinkingEffort: "off",
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

export async function uniqueConversationTitle(
  base: string,
  excludeId?: string,
  source?: ConversationMeta[],
): Promise<string> {
  const list = source ?? (await listConversations());
  const used = new Set(list.filter((c) => c.id !== excludeId).map((c) => c.title));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function insightWebKey(): string {
  try {
    const dir = getSettings().dataDir.trim() || "orbita-data";
    return `orbita.data.stores.${dir}.ai.insight.conversations`;
  } catch {
    return "orbita.data.ai.insight.conversations";
  }
}

function readInsightWebConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(insightWebKey());
    if (raw) return JSON.parse(raw) as Conversation[];
  } catch {
    /* ignore */
  }
  return [];
}

function writeInsightWebConversations(conversations: Conversation[]) {
  localStorage.setItem(insightWebKey(), JSON.stringify(conversations));
}

async function migrateInsightWebToDisk(): Promise<void> {
  if (!isTauri()) return;
  const web = readInsightWebConversations();
  if (web.length === 0) return;
  for (const conv of web) {
    try {
      await invoke<Conversation>("read_insight_ai_conversation", { id: conv.id });
    } catch {
      try {
        await invoke("write_insight_ai_conversation", { conversation: conv });
      } catch {
        /* keep web copy if disk write fails */
        return;
      }
    }
  }
  localStorage.removeItem(insightWebKey());
}

export async function listInsightConversations(): Promise<ConversationMeta[]> {
  if (isTauri()) {
    await migrateInsightWebToDisk();
    return invoke<ConversationMeta[]>("list_insight_ai_conversations");
  }
  return readInsightWebConversations()
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadInsightConversation(id: string): Promise<Conversation> {
  if (isTauri()) {
    return invoke<Conversation>("read_insight_ai_conversation", { id });
  }
  const found = readInsightWebConversations().find((c) => c.id === id);
  if (!found) throw new Error("conversation not found");
  return found;
}

export async function saveInsightConversation(conversation: Conversation): Promise<void> {
  conversation.updatedAt = nowIso();
  if (isTauri()) {
    await invoke("write_insight_ai_conversation", { conversation });
    return;
  }
  const all = readInsightWebConversations();
  const idx = all.findIndex((c) => c.id === conversation.id);
  if (idx >= 0) all[idx] = conversation;
  else all.push(conversation);
  writeInsightWebConversations(all);
}

export async function deleteInsightConversation(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_insight_ai_conversation", { id });
    return;
  }
  writeInsightWebConversations(readInsightWebConversations().filter((c) => c.id !== id));
}

export async function uniqueInsightConversationTitle(base: string, excludeId?: string): Promise<string> {
  return uniqueConversationTitle(base, excludeId, await listInsightConversations());
}

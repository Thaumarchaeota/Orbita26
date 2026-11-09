import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import { escAttr, escHtml } from "../../core/html";
import { openUrl } from "../shell/adapter";
import type { ApiEntry } from "./config";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  createdAt?: string;
  sources?: WebSource[];
  searchStatus?: string;
};

export type WebSource = { title: string; url: string };

function isPublicSourceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && raw.length <= 2048 && host !== "localhost" && !host.endsWith(".localhost")
      && !host.endsWith(".local") && !host.endsWith(".internal")
      && !/^\[/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host);
  } catch { return false; }
}

export function searchEvidenceHtml(message: ChatMessage): string {
  if (message.searchStatus === "searching") return `<div class="ai-search-status">正在搜索网页…</div>`;
  const failure = message.searchStatus?.startsWith("failed:")
    ? `<div class="ai-search-status">网页搜索未验证：${escHtml(message.searchStatus.slice(7))}</div>` : "";
  const sources = (message.sources ?? []).filter((source) => isPublicSourceUrl(source.url)).slice(0, 8);
  if (!sources.length) return failure;
  return `${failure}<div class="ai-search-sources">网页来源：${sources.map((source, index) =>
    `<a href="${escAttr(source.url)}" data-search-source="1" target="_blank" rel="noopener noreferrer">${index + 1}. ${escHtml(source.title)}</a>`).join(" · ")}</div>`;
}

export function handleSearchSourceClick(event: MouseEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const link = target.closest<HTMLAnchorElement>("a[data-search-source]");
  if (!link) return false;
  if (!isPublicSourceUrl(link.href)) return false;
  const url = new URL(link.href);
  event.preventDefault();
  void openUrl(url.href);
  return true;
}

export type StreamUsageInfo = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AiStreamEvent =
  | { type: "connected" }
  | { type: "chunk"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "searchStart" }
  | { type: "searchDone"; sources: WebSource[] }
  | { type: "searchError"; message: string }
  | { type: "toolStart"; name: string; label: string }
  | {
      type: "toolConfirm";
      confirmId?: string;
      confirm_id?: string;
      name: string;
      label: string;
      args: Record<string, unknown>;
    }
  | { type: "toolDone"; name: string; ok: boolean; summary: string }
  | { type: "finish"; reason?: string | null; usage?: StreamUsageInfo | null }
  | { type: "done" }
  | { type: "error"; message: string };

export type AiEntryPoint = "panel" | "insight";
export type ThinkingEffort = "off" | "low" | "medium" | "high";

export async function chatStream(
  requestId: string,
  messages: ChatMessage[],
  entry: ApiEntry,
  model: string,
  onEvent: (event: AiStreamEvent) => void,
  entryPoint: AiEntryPoint = "panel",
  thinkingEffort?: ThinkingEffort,
): Promise<void> {
  if (!isTauri()) {
    onEvent({ type: "error", message: "需使用 dev.bat 运行" });
    return;
  }

  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;
  const request: Record<string, unknown> = {
    requestId,
    messages,
    apiKey: entry.apiKey,
    baseUrl: entry.baseUrl,
    model,
    entryPoint,
  };
  if (entryPoint === "insight") {
    request.thinkingEffort = thinkingEffort ?? "off";
  } else if (thinkingEffort && thinkingEffort !== "off") {
    request.thinkingEffort = thinkingEffort;
  }
  await invoke("ai_chat_stream", {
    request,
    onEvent: channel,
  });
}

export async function abortChat(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_chat_abort", { requestId });
}

export async function completeChat(
  system: string,
  user: string,
  entry: ApiEntry,
  model: string,
): Promise<string> {
  if (!isTauri()) throw new Error("需使用 dev.bat 运行");
  return await invoke<string>("ai_complete", {
    request: {
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model,
      system,
      user,
    },
  });
}

export async function generateConversationTitle(
  userMessage: string,
  assistantMessage: string,
  entry: ApiEntry,
  model: string,
  currentTitle = "",
): Promise<string> {
  if (!isTauri()) throw new Error("需使用 dev.bat 运行");
  return await invoke<string>("ai_generate_title", {
    request: {
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model,
      userMessage,
      assistantMessage,
      currentTitle,
    },
  });
}

import { Channel, invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../core/data/client";
import type { ApiEntry } from "./config";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AiStreamEvent =
  | { type: "chunk"; content: string }
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
  | { type: "done" }
  | { type: "error"; message: string };

export async function chatStream(
  requestId: string,
  messages: ChatMessage[],
  entry: ApiEntry,
  model: string,
  onEvent: (event: AiStreamEvent) => void,
): Promise<void> {
  if (!isTauri()) {
    onEvent({ type: "error", message: "需使用 dev.bat 运行" });
    return;
  }

  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = onEvent;
  await invoke("ai_chat_stream", {
    request: {
      requestId,
      messages,
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model,
    },
    onEvent: channel,
  });
}

export async function abortChat(requestId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("ai_chat_abort", { requestId });
}

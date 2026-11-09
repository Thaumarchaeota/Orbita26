import type { ChatMessage } from "./adapter";

export function countCompletedRounds(messages: ChatMessage[]): number {
  let n = 0;
  for (let i = 0; i < messages.length; i++) {
    const cur = messages[i];
    if (cur.role !== "user" || !cur.content.trim()) continue;
    const next = messages[i + 1];
    if (next?.role === "assistant" && next.content.trim()) n++;
  }
  return n;
}

export function countCompletedAssistantRounds(messages: ChatMessage[]): number {
  return countCompletedRounds(messages);
}

export function shouldAutoRenameTitle(
  titleLocked: boolean | undefined,
  completedRounds: number,
): boolean {
  return !titleLocked && completedRounds >= 1 && completedRounds <= 3;
}

export function buildTitleTranscript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = m.content.trim();
    if (!text) continue;
    lines.push(m.role === "user" ? `用户：${text}` : `助手：${text}`);
  }
  return lines.join("\n");
}

export type TitleSummarizePlan = {
  round: number;
  transcript: string;
  currentTitle: string;
};

export function titleSummarizePlan(opts: {
  titleLocked?: boolean;
  messages: ChatMessage[];
  currentTitle: string;
}): TitleSummarizePlan | null {
  const last = opts.messages[opts.messages.length - 1];
  if (last?.role !== "assistant" || !last.content.trim()) return null;
  const round = countCompletedRounds(opts.messages);
  if (!shouldAutoRenameTitle(opts.titleLocked, round)) return null;
  const transcript = buildTitleTranscript(opts.messages);
  if (!transcript) return null;
  return { round, transcript, currentTitle: opts.currentTitle };
}

export function shouldApplyGeneratedTitle(raw: string): boolean {
  const title = raw.trim();
  return title.length > 0 && title !== "新对话";
}

export function uniqueAutoTitle(base: string, usedTitles: Iterable<string>): string {
  const used = new Set(usedTitles);
  const chars = Array.from(base);
  const candidate = chars.slice(0, 8).join("");
  if (!used.has(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const room = 8 - Array.from(suffix).length;
    if (room <= 0) throw new Error("自动标题编号超出长度限制");
    const numbered = chars.slice(0, room).join("") + suffix;
    if (!used.has(numbered)) return numbered;
  }
}

export function titleModelForEntry(models: string[], activeModel: string): string {
  const plain = models.find((m) => {
    const n = m.toLowerCase();
    return !n.includes("reasoner") && !n.includes("think");
  });
  return plain ?? activeModel;
}

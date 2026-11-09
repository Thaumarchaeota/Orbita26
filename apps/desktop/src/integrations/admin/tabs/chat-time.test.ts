import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.hoisted(() => vi.fn());
const loadConversationMock = vi.hoisted(() => vi.fn());
const saveConversationMock = vi.hoisted(() => vi.fn());
const mutateSavedMessageMock = vi.hoisted(() => ({ invalid: false }));

vi.mock("../../ai/adapter", () => ({
  abortChat: vi.fn(async () => {}),
  chatStream: streamMock,
  generateConversationTitle: vi.fn(async () => ""),
  handleSearchSourceClick: vi.fn(() => false),
  searchEvidenceHtml: vi.fn(() => ""),
}));

vi.mock("../../ai/config", () => ({
  getActiveEntry: vi.fn((config: { entries: unknown[] }) => config.entries[0]),
  getAiConfig: vi.fn(),
  loadAiConfig: vi.fn(async () => ({
    activeModel: "test-model",
    activeEntryId: "entry",
    entries: [{ id: "entry", apiKey: "test-key", baseUrl: "https://example.test", models: ["test-model"] }],
  })),
  saveAiConfig: vi.fn(async () => {}),
}));

vi.mock("../../ai/conversations", () => ({
  loadInsightConversation: loadConversationMock,
  listInsightConversations: vi.fn(async () => []),
  saveInsightConversation: saveConversationMock,
  titleFromMessage: vi.fn(() => "新对话"),
  uniqueInsightConversationTitle: vi.fn((title: string) => title),
}));

vi.mock("./chat-rail", () => ({
  mountChatRail: vi.fn(() => ({
    setActive: vi.fn(),
    dispose: vi.fn(),
  })),
  releaseInsightChatScratch: vi.fn(),
}));

vi.mock("../../../core/settings", () => ({
  getSettings: vi.fn(() => ({ dataDir: "test", ui: { insightTheme: "cold" } })),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { chatDestination } from "./chat";

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localDate(parts: LocalParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
}

function localDateText(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function localTimeText(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function offsetIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const p = (n: number) => String(n).padStart(2, "0");
  const local = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:00`;
  return `${local}${sign}${hh}:${mm}`;
}

async function settle(): Promise<void> {
  // sendMessage awaits serialized persistence and the stream display queue before
  // rendering the final action row. Drain both promise continuations and its
  // short display timer so assertions observe the completed DOM.
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(100);
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

async function waitForChatDom(root: HTMLElement): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await settle();
    if (root.querySelector(".insight-chat-msg-assistant")) return;
  }
}

async function renderMessage(messageTime: Date, now: Date, isoOverride?: string) {
  vi.setSystemTime(messageTime);
  const conversation = {
    id: "time-test",
    title: "新对话",
    conversationPrompt: "",
    messages: [],
    activeEntryId: "entry",
    activeModel: "test-model",
    updatedAt: messageTime.toISOString(),
    thinkingEffort: "off" as const,
  };
  loadConversationMock.mockResolvedValueOnce(conversation);
  saveConversationMock.mockImplementation(async (saved: typeof conversation) => {
    if (isoOverride) {
      saved.messages
        .filter((message) => message.role === "assistant")
        .forEach((message) => { message.createdAt = isoOverride; });
    }
  });

  const root = document.createElement("div");
  document.body.append(root);
  const handle = chatDestination.mount(root);
  handle.activate?.();
  await waitForChatDom(root);
  const input = root.querySelector<HTMLTextAreaElement>('[data-region="input"]')!;
  input.value = "test";
  root.querySelector<HTMLFormElement>('[data-region="form"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  vi.setSystemTime(now);
  return { root, handle, time: root.querySelector<HTMLButtonElement>(".insight-chat-msg-time") };
}

describe("Insight chat message time display", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    streamMock.mockImplementation(async (
      _id: string,
      _messages: unknown[],
      _entry: unknown,
      _model: string,
      onEvent: (event: unknown) => void,
    ) => {
      onEvent({ type: "chunk", content: "answer" });
      onEvent({ type: "finish" });
    });
    mutateSavedMessageMock.invalid = false;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses HH:mm for a message whose local calendar date is today", async () => {
    const now = localDate({ year: 2026, month: 10, day: 2, hour: 10, minute: 15 });
    const result = await renderMessage(localDate({ year: 2026, month: 10, day: 2, hour: 9, minute: 5 }), now);
    expect(result.time?.textContent).toBe("09:05");
    result.handle.dispose();
  });

  it.each([
    ["crosses midnight", localDate({ year: 2026, month: 10, day: 1, hour: 23, minute: 55 }), localDate({ year: 2026, month: 10, day: 2, hour: 0, minute: 5 })],
    ["crosses year", localDate({ year: 2025, month: 12, day: 31, hour: 23, minute: 55 }), localDate({ year: 2026, month: 1, day: 1, hour: 0, minute: 5 })],
  ])("uses YYYY-MM-DD HH:mm when the local date %s", async (_label, messageTime, now) => {
    const result = await renderMessage(messageTime as Date, now as Date);
    expect(result.time?.textContent).toBe(`${localDateText(messageTime as Date)} ${localTimeText(messageTime as Date)}`);
    result.handle.dispose();
  });

  it("uses the local calendar date for Z and equivalent offset ISO values around midnight", async () => {
    const message = localDate({ year: 2027, month: 1, day: 1, hour: 0, minute: 5 });
    const now = localDate({ year: 2027, month: 1, day: 1, hour: 10, minute: 0 });
    const z = await renderMessage(message, now);
    expect(z.time?.textContent).toBe("00:05");
    z.handle.dispose();

    const offset = await renderMessage(message, now, offsetIso(message));
    expect(offset.time?.textContent).toBe("00:05");
    offset.handle.dispose();
  });

  it("omits the time button for an invalid ISO timestamp", async () => {
    const message = localDate({ year: 2026, month: 10, day: 2, hour: 9, minute: 5 });
    const result = await renderMessage(message, message, "not-an-iso-timestamp");
    expect(result.time).toBeNull();
    result.handle.dispose();
  });

  it("switches between absolute and relative text and refreshes relative time", async () => {
    const message = localDate({ year: 2026, month: 10, day: 2, hour: 9, minute: 5 });
    const now = localDate({ year: 2026, month: 10, day: 2, hour: 10, minute: 15 });
    const result = await renderMessage(message, now);
    const time = result.time!;
    expect(time.dataset.rel).toBe("0");
    expect(time.textContent).toBe("09:05");

    time.click();
    expect(time.dataset.rel).toBe("1");
    expect(time.textContent).toBe("1h ago");

    vi.setSystemTime(localDate({ year: 2026, month: 10, day: 2, hour: 11, minute: 16 }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(time.textContent).toBe("2h ago");

    time.click();
    expect(time.dataset.rel).toBe("0");
    expect(time.textContent).toBe("09:05");
    result.handle.dispose();
  });
});

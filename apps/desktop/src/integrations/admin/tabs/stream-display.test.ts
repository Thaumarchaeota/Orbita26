import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamDisplayQueue } from "../../ai/stream-display";

describe("StreamDisplayQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes the entire pending buffer each interval, not a fraction", () => {
    const seen: string[] = [];
    const q = new StreamDisplayQueue({
      intervalMs: 50,
      onFlush: (text) => {
        seen.push(text);
      },
    });
    q.push("abcdefghij");
    vi.advanceTimersByTime(50);
    expect(seen).toEqual(["abcdefghij"]);
    q.dispose();
  });

  it("flushNow emits remainder immediately", () => {
    const seen: Array<{ text: string; final: boolean }> = [];
    const q = new StreamDisplayQueue({
      intervalMs: 50,
      onFlush: (text, isFinal) => {
        seen.push({ text, final: isFinal });
      },
    });
    q.push("ab");
    q.flushNow();
    expect(seen.at(-1)).toEqual({ text: "ab", final: true });
  });
});

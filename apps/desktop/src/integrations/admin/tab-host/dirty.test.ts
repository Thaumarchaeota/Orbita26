import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("anyBlockingDraft", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns false when no statuses or all clean", async () => {
    const { anyBlockingDraft, setDirtyStatus } = await import("./dirty");
    expect(anyBlockingDraft()).toBe(false);
    setDirtyStatus("fixed:finance", { dirty: false, inFlight: false, failed: false });
    expect(anyBlockingDraft()).toBe(false);
  });

  it("returns true when any status is dirty", async () => {
    const { anyBlockingDraft, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("a", { dirty: true, inFlight: false, failed: false });
    expect(anyBlockingDraft()).toBe(true);
  });

  it("returns true when any status is inFlight", async () => {
    const { anyBlockingDraft, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("a", { dirty: false, inFlight: true, failed: false });
    expect(anyBlockingDraft()).toBe(true);
  });

  it("returns true when any status is failed", async () => {
    const { anyBlockingDraft, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("a", { dirty: false, inFlight: false, failed: true });
    expect(anyBlockingDraft()).toBe(true);
  });
});

describe("waitInFlight", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true immediately when not inFlight", async () => {
    const { waitInFlight, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("k", { dirty: false, inFlight: false, failed: false });
    await expect(waitInFlight("k")).resolves.toBe(true);
  });

  it("resolves true when inFlight clears before timeout", async () => {
    const { waitInFlight, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("k", { dirty: true, inFlight: true, failed: false });
    const promise = waitInFlight("k", 500);
    vi.advanceTimersByTime(50);
    setDirtyStatus("k", { dirty: true, inFlight: false, failed: false });
    await expect(promise).resolves.toBe(true);
  });

  it("resolves false on timeout when inFlight never clears", async () => {
    const { waitInFlight, setDirtyStatus } = await import("./dirty");
    setDirtyStatus("k", { dirty: false, inFlight: true, failed: false });
    const promise = waitInFlight("k", 200);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toBe(false);
  });
});

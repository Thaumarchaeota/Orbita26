import { beforeEach, describe, expect, it, vi } from "vitest";

const garminSync = vi.hoisted(() => vi.fn());
const subscribeGarminSyncing = vi.hoisted(() => vi.fn(() => vi.fn()));
const isGarminSyncing = vi.hoisted(() => vi.fn(() => false));
const alertMock = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
  beijingToday: () => "2026-10-01",
  formatGarminError: (reason: string, message?: string) => message ?? reason,
  garminSync,
  isGarminSyncing,
  subscribeGarminSyncing,
  syncFromDate: (days: number) => `2026-09-${String(days).padStart(2, "0")}`,
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => ({ integrations: { garmin: { syncDays: 7 } } }),
}));

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("Garmin sync button lifecycle and notification branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGarminSyncing.mockReturnValue(false);
    vi.stubGlobal("alert", alertMock);
    subscribeGarminSyncing.mockImplementation(() => vi.fn());
  });

  it("uses the native alert fallback when no error callback is supplied", async () => {
    garminSync.mockResolvedValue({ ok: false, reason: "NETWORK", message: "网络不可用" });
    const { bindGarminSyncButton } = await import("./garmin-sync-button");
    const button = document.createElement("button");
    bindGarminSyncButton(button);

    button.click();
    await flushPromises();

    expect(alertMock).toHaveBeenCalledWith("网络不可用");
  });

  it("routes failures to the supplied callback instead of the default alert", async () => {
    garminSync.mockResolvedValue({ ok: false, reason: "NETWORK", message: "回调错误" });
    const onError = vi.fn();
    const { bindGarminSyncButton } = await import("./garmin-sync-button");
    const button = document.createElement("button");
    bindGarminSyncButton(button, { onError });

    button.click();
    await flushPromises();

    expect(onError).toHaveBeenCalledWith("回调错误");
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("does not deliver a late success to an already disposed button", async () => {
    let resolveSync!: (result: unknown) => void;
    garminSync.mockReturnValue(new Promise((resolve) => (resolveSync = resolve)));
    const onSuccess = vi.fn();
    const { bindGarminSyncButton } = await import("./garmin-sync-button");
    const button = document.createElement("button");
    const dispose = bindGarminSyncButton(button, { onSuccess });

    button.click();
    dispose();
    resolveSync({ ok: true, dailyCount: 2, routineCount: 3, exerciseCount: 4 });
    await Promise.resolve();
    await Promise.resolve();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(button.classList.contains("is-success")).toBe(false);
  });

  it("does not start Garmin sync when disposed while beforeSync is still pending", async () => {
    let releaseBeforeSync!: () => void;
    const beforeSync = vi.fn(() => new Promise<void>((resolve) => (releaseBeforeSync = resolve)));
    garminSync.mockResolvedValue({ ok: true });
    const { bindGarminSyncButton } = await import("./garmin-sync-button");
    const button = document.createElement("button");
    const dispose = bindGarminSyncButton(button, { beforeSync });

    button.click();
    await flushPromises();
    dispose();
    releaseBeforeSync();
    await flushPromises();

    expect(garminSync).not.toHaveBeenCalled();
  });

  it("clears the success timer when disposed", async () => {
    vi.useFakeTimers();
    garminSync.mockResolvedValue({ ok: true, dailyCount: 1 });
    const { bindGarminSyncButton } = await import("./garmin-sync-button");
    const button = document.createElement("button");
    const dispose = bindGarminSyncButton(button);

    button.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(button.classList.contains("is-success")).toBe(true);
    dispose();
    vi.advanceTimersByTime(2000);
    expect(button.classList.contains("is-success")).toBe(false);
    vi.useRealTimers();
  });
});

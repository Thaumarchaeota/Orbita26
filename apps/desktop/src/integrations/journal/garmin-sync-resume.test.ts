import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const domainWrite = vi.hoisted(() => vi.fn());
const confirmDialog = vi.hoisted(() => vi.fn());

vi.mock("../admin/domain-write-guard", () => ({ invokeDomainWrite: domainWrite }));
vi.mock("../shell/dialog", () => ({ getConfirmDialog: () => confirmDialog }));
vi.mock("../../core/data/client", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));
const paused = {
  ok: false,
  reason: "GARMIN_DAILY_PAUSED",
  message: "daily paused",
  resumeJob: {
    requestId: "resume-r1",
    expectedDataDirKey: "dir-key-a",
    jobId: "daily-job-7",
    expectedRevision: 12,
  },
};

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("daily Garmin paused-task recovery confirmation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    confirmDialog.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("manual sync confirms the exact snapshot and sends it on the second invoke", async () => {
    domainWrite.mockResolvedValueOnce(paused).mockResolvedValueOnce({ ok: true, dailyCount: 7 });
    const { garminSync } = await import("./client");

    const result = await garminSync({ entryPoint: "manual" });

    expect(confirmDialog).toHaveBeenCalledWith(
      "继续佳明日常同步",
      paused.message,
      undefined,
      { confirmLabel: "继续同步并重试未成功项", danger: false },
    );
    expect(domainWrite).toHaveBeenCalledTimes(2);
    expect(domainWrite.mock.calls[1][1].req.resumeJob).toEqual(paused.resumeJob);
    expect(result).toMatchObject({ ok: true });
  });

  it("cancel leaves the original paused result and never makes a second request", async () => {
    confirmDialog.mockResolvedValue(false);
    domainWrite.mockResolvedValueOnce(paused);
    const { garminSync } = await import("./client");

    const result = await garminSync({ entryPoint: "manual" });

    expect(domainWrite).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: "GARMIN_SYNC_CANCELLED" });
  });

  it("automatic sync never opens confirmation or resumes", async () => {
    domainWrite.mockResolvedValueOnce(paused);
    const { garminSync } = await import("./client");

    const result = await garminSync({ entryPoint: "auto" });

    expect(domainWrite).toHaveBeenCalledTimes(1);
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(result).toEqual(paused);
  });

  it("time spent waiting for confirmation does not consume the retry request timeout", async () => {
    vi.useFakeTimers();
    let resolveConfirmation!: (value: boolean) => void;
    confirmDialog.mockReturnValue(new Promise<boolean>((resolve) => (resolveConfirmation = resolve)));
    let resolveRetry!: (value: { ok: boolean }) => void;
    domainWrite.mockResolvedValueOnce(paused).mockReturnValueOnce(
      new Promise((resolve) => (resolveRetry = resolve)),
    );
    const { garminSync } = await import("./client");

    const pending = garminSync({ entryPoint: "manual" });
    await flush();
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    resolveConfirmation(true);
    await flush();

    expect(domainWrite).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    resolveRetry({ ok: true });
    await expect(pending).resolves.toMatchObject({ ok: true });
  });
});

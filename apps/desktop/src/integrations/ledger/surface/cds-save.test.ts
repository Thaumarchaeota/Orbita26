import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import { cloneDetailItems } from "../utils";

const loadDetailMock = vi.fn().mockResolvedValue(undefined);
const markSaveSucceededSpy = vi.fn();
const postValidateMock = vi.fn();
const postCommitMock = vi.fn();

vi.mock("../api/client", () => ({
  postValidate: (...args: unknown[]) => postValidateMock(...args),
  postCommit: (...args: unknown[]) => postCommitMock(...args),
}));

vi.mock("../state/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/ledger")>();
  return {
    ...actual,
    ensureLoadReady: vi.fn().mockResolvedValue(true),
    loadDetail: (...args: unknown[]) => loadDetailMock(...args),
    markSaveSucceeded: () => {
      markSaveSucceededSpy();
      return actual.markSaveSucceeded();
    },
  };
});

import {
  __testResetLedgerStore,
  enterConfirming,
  getSavePhase,
  getWorkGeneration,
  isLedgerDirty,
  isPostCommitRefreshFailed,
  returnToEditedAfterCheckFailure,
  setDetailEntries,
  updateEntryField,
} from "../state/ledger-store";
import { runCardStoreSave } from "./card-store-save";

function makeEntry(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-01-02",
    flag: "*",
    payee: "",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a0",
  };
}

const callbacks = {
  onValidationErrors: vi.fn(),
  onSavePhaseChange: vi.fn(),
  onCommitSuccess: vi.fn().mockResolvedValue(undefined),
  shake: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  __testResetLedgerStore();
  vi.stubGlobal("alert", vi.fn());
  loadDetailMock.mockClear();
  markSaveSucceededSpy.mockClear();
  postValidateMock.mockReset();
  postCommitMock.mockReset();
  callbacks.onValidationErrors.mockClear();
  callbacks.onCommitSuccess.mockClear();
  loadDetailMock.mockResolvedValue(undefined);
  postValidateMock.mockResolvedValue({
    data: {
      ok: true,
      validation_token: "token",
      candidate_hash: "hash",
      identity_backfill: [],
    },
  });
  postCommitMock.mockResolvedValue({ res: { ok: true }, data: { ok: true } });
});

describe("runCardStoreSave", () => {
  it("marks save succeeded immediately after commit without waiting for reload", async () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token", "hash");

    let reloadDone = false;
    loadDetailMock.mockImplementation(async () => {
      reloadDone = true;
    });

    await runCardStoreSave(callbacks);

    expect(postCommitMock).toHaveBeenCalled();
    expect(markSaveSucceededSpy).toHaveBeenCalled();
    expect(getSavePhase()).toBe("unedited");
    expect(callbacks.onCommitSuccess).toHaveBeenCalled();
    expect(reloadDone).toBe(true);
    expect(markSaveSucceededSpy.mock.invocationCallOrder[0]).toBeLessThan(
      loadDetailMock.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps save succeeded and sets post-commit refresh failed when reload fails", async () => {
    loadDetailMock.mockRejectedValueOnce(new Error("reload failed"));
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token-retry", "hash-retry");

    await runCardStoreSave(callbacks);

    expect(markSaveSucceededSpy).toHaveBeenCalled();
    expect(callbacks.onCommitSuccess).toHaveBeenCalled();
    expect(getSavePhase()).toBe("unedited");
    expect(isPostCommitRefreshFailed()).toBe(true);
    expect(isLedgerDirty()).toBe(false);
  });

  it("retries authoritative reload from post-commit refresh failed without commit", async () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token", "hash");

    loadDetailMock.mockRejectedValueOnce(new Error("reload failed"));
    await runCardStoreSave(callbacks);
    expect(isPostCommitRefreshFailed()).toBe(true);
    expect(postCommitMock).toHaveBeenCalledTimes(1);

    loadDetailMock.mockResolvedValueOnce(undefined);
    await runCardStoreSave(callbacks);

    expect(postCommitMock).toHaveBeenCalledTimes(1);
    expect(isPostCommitRefreshFailed()).toBe(false);
  });

  it("discards stale reload when user edits after commit success", async () => {
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token", "hash");

    let resolveReload: (() => void) | undefined;
    const workGenAtCommit = getWorkGeneration();
    loadDetailMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        }),
    );

    const savePromise = runCardStoreSave(callbacks);
    await vi.waitFor(() => expect(markSaveSucceededSpy).toHaveBeenCalled());
    updateEntryField("e1", { field: "remark", value: "edited after save" });
    resolveReload?.();
    await savePromise;

    expect(getWorkGeneration()).toBeGreaterThan(workGenAtCommit);
    expect(loadDetailMock).toHaveBeenCalledWith(true, workGenAtCommit);
  });

  it("returns to edited after candidate validate failure", async () => {
    postValidateMock.mockResolvedValueOnce({
      data: {
        ok: false,
        diagnostics: [{ message: "bad", item_ids: ["e1"] }],
      },
    });
    setDetailEntries([makeEntry("e1")]);

    await runCardStoreSave(callbacks);

    expect(getSavePhase()).toBe("edited");
    expect(isLedgerDirty()).toBe(true);
    expect(callbacks.onValidationErrors).toHaveBeenCalled();
    expect(markSaveSucceededSpy).not.toHaveBeenCalled();
  });

  it("returns to confirming after commit failure", async () => {
    postCommitMock.mockResolvedValueOnce({
      res: { ok: true },
      data: { ok: false, error: "commit failed" },
    });
    const entries = [makeEntry("e1")];
    setDetailEntries(entries);
    enterConfirming(cloneDetailItems(entries), "token", "hash");

    await runCardStoreSave(callbacks);

    expect(getSavePhase()).toBe("confirming");
    expect(markSaveSucceededSpy).not.toHaveBeenCalled();
    expect(loadDetailMock).not.toHaveBeenCalled();
  });
});

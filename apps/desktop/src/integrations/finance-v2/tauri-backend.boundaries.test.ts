import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../shell/adapter", () => ({ openLocalPath: vi.fn() }));

function sanitizedInvokeHistory(): Array<{ command: string; argumentKeys: string[] }> {
  return invokeMock.mock.calls.map(([command, args]) => ({
    command: typeof command === "string" ? command : `<${typeof command}>`,
    argumentKeys: args && typeof args === "object" ? Object.keys(args as object) : [],
  }));
}

import { financeV2TauriBackend } from "./tauri-backend";
import type { FinanceImportBatchView, IsolatedFinanceSession } from "./types";

const session: IsolatedFinanceSession = {
  sessionId: "session", rootPath: "C:/synthetic-ledger", workspaceId: "workspace", ledgerIdentity: "ledger",
  markerVersion: 1, scope: "isolated", generation: 4,
};
const batch = { draftId: "draft", draftRevision: 3, durableRevision: 3, baseGeneration: 4, rows: [] } as FinanceImportBatchView;

function preparedResponse() {
  return {
    plan: { operationId: "op-1", payloadSha256: "a".repeat(64), requiredDurableRevision: 3, ledgerGeneration: 4 },
    prepareToken: "token", durableRevision: 3, recordedAtUtcUs: 1_800_000_000_000_000,
  };
}

describe("Finance v2 commit receipt boundary", () => {
  beforeEach(() => { invokeMock.mockReset(); });

  it("looks up the same operation after a lost commit reply and returns pending recovery", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "finance_v2_prepare_commit") return preparedResponse();
      if (command === "finance_v2_commit_batch") throw new Error("IPC reply lost");
      if (command === "finance_v2_find_receipt") return {
        receipt: { operationId: "op-1", receiptId: "receipt-1", payloadSha256: "a".repeat(64), generation: 5 },
        materializationJob: { jobId: "job-1", status: "Ready" },
      };
      throw new Error(`unexpected invoke signature ${JSON.stringify(sanitizedInvokeHistory())}`);
    });

    const status = await financeV2TauriBackend.commitPrepared(session, batch);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "finance_v2_prepare_commit", "finance_v2_commit_batch", "finance_v2_find_receipt",
    ]);
    expect(invokeMock.mock.calls[2][1]).toMatchObject({ operationId: "op-1" });
    expect(status.operationId).toBe("op-1");
    expect(status.receiptId).toBe("receipt-1");
    expect(status.generation).toBe(5);
    expect(status.commitState).toBe("Committed");
    expect(status.pendingMaterialization).toBeTruthy();
  });

  it("refuses to treat a receipt with a different payload hash as this operation", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "finance_v2_prepare_commit") return preparedResponse();
      if (command === "finance_v2_commit_batch") throw new Error("IPC reply lost");
      if (command === "finance_v2_find_receipt") return {
        receipt: { operationId: "op-1", receiptId: "receipt-1", payloadSha256: "b".repeat(64), generation: 5 },
        materializationJob: { jobId: "job-1", status: "Ready" },
      };
      throw new Error(`unexpected invoke signature ${JSON.stringify(sanitizedInvokeHistory())}`);
    });

    await expect(financeV2TauriBackend.commitPrepared(session, batch)).rejects.toThrow("payload hash");
    expect(invokeMock.mock.calls.filter(([command]) => command === "finance_v2_commit_batch")).toHaveLength(1);
  });
});

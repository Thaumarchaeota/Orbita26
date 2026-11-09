import { beforeEach, describe, expect, it, vi } from "vitest";

const loadAiConfigMock = vi.hoisted(() => vi.fn());
const completeChatMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/config", () => ({
  loadAiConfig: loadAiConfigMock,
  getActiveEntry: (config: { entries: Array<{ id: string; models: string[] }> }) => config.entries[0] ?? null,
}));
vi.mock("../ai/adapter", () => ({ completeChat: completeChatMock }));

import { canApplyWorkspaceClassification, globalFinanceAiProvider } from "./ai";
import type { ClassificationRequest, FinanceAccountView, FinanceWorkspaceLeftRowView } from "./types";

const request: ClassificationRequest = {
  item_id: "item-1", expected_item_revision: 2, expected_manual_category_revision: 3,
  merchant: "Synthetic 1234 5678 9012 3456", summary: "lunch", notes: "ref 1234567890123456",
  amount_text: "12.00", commodity: "CNY",
};
const account: FinanceAccountView = {
  id: "expenses:food", revision: 7, name: "Food", kind: "Expenses", beanPath: "Expenses:Food", parentId: null,
  active: true, everUsed: false,
};

describe("Finance v2 AI boundaries", () => {
  beforeEach(() => {
    loadAiConfigMock.mockReset().mockResolvedValue({ entries: [{ id: "entry", models: ["model"] }] });
    completeChatMock.mockReset().mockResolvedValue(JSON.stringify({
      item_id: request.item_id, expected_item_revision: 2, expected_manual_category_revision: 3,
      account_id: account.id, account_revision: account.revision,
    }));
  });

  it("sends only the classification summary and masks long numeric identifiers", async () => {
    const results = await globalFinanceAiProvider.classify([request], {
      model: "model", signal: new AbortController().signal, accounts: [account], rulesMarkdown: "synthetic rules",
    });
    expect(results[0].result?.account_id).toBe(account.id);
    const promptPayload = String(completeChatMock.mock.calls[0][1]);
    expect(promptPayload).toContain("[已隐藏数字标识]");
    expect(promptPayload).not.toContain("1234 5678 9012 3456");
    expect(promptPayload).not.toContain("1234567890123456");
    expect(promptPayload).not.toContain("raw_text");
  });

  it("does not apply an AI suggestion to a manually categorized row", () => {
    const row = {
      itemId: request.item_id, itemRevision: 2, manualCategoryRevision: 3, stillInLeft: true,
      disposition: "Open", categoryOrigin: "Human",
    } as FinanceWorkspaceLeftRowView;
    const result = {
      item_id: request.item_id, expected_item_revision: 2, expected_manual_category_revision: 3,
      account_id: account.id, account_revision: account.revision,
    };
    expect(canApplyWorkspaceClassification(request, result, row, false, new Map([[account.id, account.revision]]))).toBe(false);
  });
});

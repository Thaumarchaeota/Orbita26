import { describe, expect, it } from "vitest";
import { formatLedgerNetworkError } from "./client";

describe("formatLedgerNetworkError", () => {
  it("maps Failed to fetch to actionable finance service message", () => {
    const msg = formatLedgerNetworkError(new TypeError("Failed to fetch"), "/api/stats");
    expect(msg).toContain("无法连接财务服务");
    expect(msg).toContain("/api/stats");
    expect(msg).not.toBe("Failed to fetch");
  });
});

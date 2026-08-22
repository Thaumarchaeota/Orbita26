import { describe, expect, it } from "vitest";
import { CARD_DETAIL_FIXTURES } from "./fixtures";
import { resolveStripeKind } from "./stripe-kind";
import { renderDetailItemCard } from "./render-cards";

describe("resolveStripeKind", () => {
  it("maps metadata bkeasy-type to extended stripe kinds", () => {
    const proxy = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260805_01")!;
    const repayment = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260808_02")!;
    expect(resolveStripeKind(proxy)).toBe("proxy-expense");
    expect(resolveStripeKind(repayment)).toBe("repayment");
  });

  it("uses unknown stripe for unclassified transactions", () => {
    const transfer = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260809_04")!;
    expect(resolveStripeKind(transfer)).toBe("transfer");
    const wrap = renderDetailItemCard(transfer);
    expect(wrap.querySelector(".cds-stripe-unknown")).toBeNull();
  });

  it("prefers metadata bkeasy-type over inferred entry type for stripe", () => {
    const txn = CARD_DETAIL_FIXTURES.find((item) => item.id === "txn_fixture_20260805_01")!;
    expect(txn.kind).toBe("transaction");
    if (txn.kind !== "transaction") return;
    expect(txn.type).toBe("expense");
    expect(resolveStripeKind(txn)).toBe("proxy-expense");
  });
});

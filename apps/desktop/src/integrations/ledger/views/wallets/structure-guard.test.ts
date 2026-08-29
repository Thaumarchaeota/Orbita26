import { describe, expect, it } from "vitest";
import { structureGuardReason } from "./structure-guard";

describe("structure guard", () => {
  it("blocks ledger work copy before all structure operations", () => {
    expect(structureGuardReason(true, false)).toBe("请先保存或撤销账本更改");
  });
  it("blocks category work copy when ledger is clean", () => {
    expect(structureGuardReason(false, true)).toBe("请先保存或撤销分类更改");
  });
  it("allows a clean structure session", () => {
    expect(structureGuardReason(false, false)).toBeNull();
  });
});

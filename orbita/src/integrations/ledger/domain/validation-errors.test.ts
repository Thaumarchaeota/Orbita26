import { describe, expect, it } from "vitest";
import {
  collectGlobalValidationMessages,
  collectValidationMarkedEntryIds,
  resolveValidationFocusEntryId,
} from "./validation-errors";
import type { CandidateDiagnostic } from "../types";

describe("resolveValidationFocusEntryId", () => {
  it("reads entry_id from ValidateError shape", () => {
    expect(resolveValidationFocusEntryId({ entry_id: "e1", field: "date", error: "x" })).toBe("e1");
  });

  it("reads first item_id from CandidateDiagnostic", () => {
    expect(resolveValidationFocusEntryId({ message: "m", item_ids: ["a", "b"] })).toBe("a");
  });
});

describe("collectValidationMarkedEntryIds", () => {
  it("collects unique ids from mixed errors", () => {
    const ids = collectValidationMarkedEntryIds([
      { entry_id: "e1", field: "a", error: "x" },
      { message: "m", item_ids: ["e2", "e1"] },
    ]);
    expect(ids.sort()).toEqual(["e1", "e2"]);
  });
});

describe("collectGlobalValidationMessages", () => {
  it("keeps global errors when item-level diagnostics exist", () => {
    const errors: CandidateDiagnostic[] = [
      { message: "全局阻断", item_ids: [] },
      { message: "条目错误", item_ids: ["e1"] },
    ];
    expect(collectGlobalValidationMessages(errors)).toEqual(["全局阻断"]);
  });

  it("returns multiple global messages", () => {
    const errors: CandidateDiagnostic[] = [
      { message: "错误 A", item_ids: [] },
      { message: "错误 B", item_ids: [] },
    ];
    expect(collectGlobalValidationMessages(errors)).toEqual(["错误 A", "错误 B"]);
  });
});

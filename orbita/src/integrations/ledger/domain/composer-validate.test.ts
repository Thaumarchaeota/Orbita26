import { beforeEach, describe, expect, it } from "vitest";
import { setAccounts } from "../state/accounts";
import { validateComposerPostings } from "./composer-validate";

describe("validateComposerPostings", () => {
  beforeEach(() => {
    setAccounts({
      assets: [], liabilities: [], expenses: [], income: [],
      equity: [{
        name: "Equity:Opening", label: "期初", label_path: ["Equity", "Opening"], brief: "",
        open_date: "", extra: "", id: "equity-1", source_file: "account.bean", source_line: 1,
      }],
    });
  });

  it("accepts declared Equity postings for advanced composer validation", () => {
    expect(validateComposerPostings([
      { account: "Equity:Opening", amount: 100, currency: "CNY" },
      { account: "Equity:Opening", amount: -100, currency: "CNY" },
    ])).toBeNull();
  });
});

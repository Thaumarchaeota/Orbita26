import { mountLedgerDestination } from "../../ledger/destination";
import type { InsightDestination } from "../types";

export const financeDestination: InsightDestination = {
  id: "finance",
  kind: "domain",
  label: "财务",
  icon: "finance",
  mount(root, ctx) {
    return mountLedgerDestination(root, ctx);
  },
};

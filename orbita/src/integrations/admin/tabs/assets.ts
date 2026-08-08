import { mountLedgerApp } from "../../ledger";
import type { AdminTabDefinition } from "../types";

export const assetsTab: AdminTabDefinition = {
  id: "assets",
  label: "资产",
  mount(panel) {
    return mountLedgerApp(panel);
  },
};

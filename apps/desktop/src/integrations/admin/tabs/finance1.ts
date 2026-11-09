import type { InsightDestination } from "../types";
import { financeV2Destination } from "./finance-v2";

export const finance1Destination: InsightDestination = {
  ...financeV2Destination,
  id: "finance1",
  label: "记账1",
};

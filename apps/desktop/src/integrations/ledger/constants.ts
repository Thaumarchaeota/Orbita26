export const REMARK_MAX_LENGTH = 50;
export const SUCCESS_MIN_MS = 500;
export const ERROR_MIN_MS = 600;
export const DEFAULT_WRITE_TARGET = "ledger/2026.bean";
export const DEFAULT_CURRENCY = "CNY";

export const RECENT_DAYS = 90;
export const ROW_HEIGHT_ESTIMATE = 130;
/** @deprecated legacy detail list only; CardDetailSurface uses card buffer constants in domain/virtual-list */
export const VIRTUAL_BUFFER = 4;
export const VIRTUAL_BUFFER_ABOVE_MIN = 100;
export const VIRTUAL_BUFFER_ABOVE_MAX = 150;
export const VIRTUAL_BUFFER_BELOW_MIN = 150;
export const VIRTUAL_BUFFER_BELOW_MAX = 200;
/** Full continuous render until this count; above it virtual mode protects render performance. docs/adr/0001-finance-detail-render-threshold.md */
export const LIST_FULL_MAX_COUNT = 10_000;
export const DATE_PIN_HEIGHT = 44;
export const ACCOUNT_PAD_CH = 30;
export const MAX_POSTINGS = 10;
export const EPSILON = 0.001;

export const TYPE_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "转账",
  inv: "投资",
};

export const DATE_HEADER_HEIGHT = 36;

export { ACTION_CHECK_ICON as CHECK_ICON } from "../../ui/action-motion";

export const CSV_HEADERS = [
  "date",
  "time",
  "type",
  "amount",
  "currency",
  "from_account",
  "to_account",
  "payee",
  "remark",
  "tags",
] as const;

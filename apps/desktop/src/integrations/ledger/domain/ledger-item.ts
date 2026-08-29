export type DecimalString = string;
export type ISODate = string;
export type Seq = string;
export type Metadata = Array<{ key: string; value: string }>;

export type Posting = {
  account: string;
  amount: DecimalString;
  currency: string;
  cost_amount: DecimalString | null;
  cost_currency: string | null;
};

export type Transaction = {
  kind: "transaction";
  id: string;
  source_file: string;
  source_line: number;
  date: ISODate;
  flag: string;
  payee: string;
  remark: string;
  tags: string[];
  postings: Posting[];
  metadata: Metadata;
  type: "expense" | "income" | "transfer" | "";
  seq: Seq;
};

export type Pad = {
  kind: "pad";
  id: string;
  source_file: string;
  source_line: number;
  date: ISODate;
  account: string;
  source_account: string;
  seq: Seq;
};

export type Balance = {
  kind: "balance";
  id: string;
  source_file: string;
  source_line: number;
  date: ISODate;
  account: string;
  amount: DecimalString;
  currency: string;
  seq: Seq;
};

export type LedgerItem = Transaction | Pad | Balance;

export type CandidateDiagnostic = {
  message: string;
  item_ids: string[];
  raw?: string;
};

export type SavePhase =
  | "unedited"
  | "edited"
  | "checking"
  | "confirming"
  | "submitting"
  | "refresh_failed";

export const ORBITA_ID_RE = /^txn_[0-9A-HJKMNP-TV-Z]{26}$/;

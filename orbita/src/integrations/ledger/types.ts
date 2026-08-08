export type EntryType = "expense" | "income" | "transfer" | "inv";

export type Posting = {
  account: string;
  amount: number;
  currency: string;
  cost_amount?: number | null;
  cost_currency?: string;
};

export type Entry = {
  id: string;
  source_file: string;
  source_line: number;
  type: EntryType;
  date: string;
  flag: string;
  payee: string;
  remark: string;
  tags: string;
  seq: string;
  postings: Posting[];
  _is_new?: boolean;
  _deleted?: boolean;
};

export type AccountRecord = {
  name: string;
  label: string;
  label_path: string[];
  brief: string;
  open_date: string;
  extra: string;
  id: string;
  source_file: string;
  source_line: number;
};

export type AccountsResponse = {
  expenses: AccountRecord[];
  income: AccountRecord[];
  assets: AccountRecord[];
  liabilities: AccountRecord[];
};

export type SettingsResponse = {
  write_target: string;
};

export type EntriesQuery = {
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

export type EntriesResponse = {
  entries: Entry[];
  total?: number;
  has_more?: boolean;
  date_min?: string;
  date_max?: string;
};

export type CommitPayload = {
  files: Record<string, Entry[]>;
};

export type CommitResult = {
  file: string;
  ok: boolean;
  error?: string;
};

export type CommitResponse = {
  ok: boolean;
  results: CommitResult[];
};

export type ValidateError = {
  entry_id: string;
  field: string;
  error: string;
};

export type ValidateResponse = {
  ok: boolean;
  errors: ValidateError[];
};

export type CategoryModel = {
  id: string;
  source_file: string;
  source_line: number;
  name: string;
  label: string;
  open_date: string;
  extra: string;
};

export type CategoryCommitPayload = {
  categories: CategoryModel[];
};

export type AccountGroup = "expenses" | "income" | "assets" | "liabilities";

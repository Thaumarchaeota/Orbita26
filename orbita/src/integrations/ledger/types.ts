export type EntryType = "expense" | "income" | "transfer" | "inv";

export type Posting = {
  account: string;
  amount: number | null;
  currency: string;
  price_amount?: number | null;
  price_currency?: string;
  cost_amount?: number | null;
  cost_currency?: string;
  lot_amount?: number | null;
  lot_currency?: string;
  lot_date?: string;
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
  kind: "transaction";
  metadata?: Array<{ key: string; value: string }>;
  _is_new?: boolean;
  _deleted?: boolean;
};

export type PadItem = {
  kind: "pad";
  id: string;
  source_file: string;
  source_line: number;
  date: string;
  account: string;
  source_account: string;
  seq: string;
};

export type BalanceItem = {
  kind: "balance";
  id: string;
  source_file: string;
  source_line: number;
  date: string;
  account: string;
  amount: string;
  currency: string;
  seq: string;
};

export type DetailItem = Entry | PadItem | BalanceItem;

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
  reporting_currency: string;
  card_stripes?: CardStripesSettings;
};

export type CardStripesSettings = Partial<
  Record<
    | "expense"
    | "proxy_expense"
    | "income"
    | "transfer"
    | "repayment"
    | "pad"
    | "balance",
    string
  >
>;

export type AccountBalance = {
  currency: string;
  amount: string;
};

export type AccountStats = {
  account: string;
  balances: AccountBalance[];
  assertion_status: "pass" | "fail" | "none";
  assertion_date: string | null;
};

export type CategoryExpenseStat = {
  account: string;
  total: number;
};

export type CategoryIncomeStat = CategoryExpenseStat;

export type StatsResponse = {
  ok: boolean;
  error?: string;
  reporting_currency?: string;
  accounts?: AccountStats[];
  month_expenses_total?: number;
  month_expenses_by_category?: CategoryExpenseStat[];
  month_income_total?: number;
  month_income_by_category?: CategoryIncomeStat[];
};

export type EntriesQuery = {
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
};

export type EntriesResponse = {
  entries: DetailItem[];
  diagnostics?: CandidateDiagnostic[];
  total?: number;
  has_more?: boolean;
  date_min?: string;
  date_max?: string;
};

export type CommitPayload = {
  items: Array<
    | {
        kind?: "transaction";
        id: string;
        source_file: string;
        source_line: number;
        type: string;
        date: string;
        flag: string;
        payee: string;
        remark: string;
        tags: string;
        seq: string;
        postings: Posting[];
      }
    | {
        kind: "pad";
        id: string;
        source_file: string;
        source_line: number;
        date: string;
        account: string;
        source_account: string;
        seq: string;
      }
    | {
        kind: "balance";
        id: string;
        source_file: string;
        source_line: number;
        date: string;
        account: string;
        amount: string;
        currency: string;
        seq: string;
      }
  >;
  validation_token: string;
  candidate_hash: string;
};

export type CommitResult = {
  file: string;
  ok: boolean;
  error?: string;
};

export type CommitResponse = {
  ok: boolean;
  error?: string;
  results?: CommitResult[];
};

export type CandidateDiagnostic = {
  message: string;
  item_ids: string[];
  raw?: string;
};

export type ValidateError = {
  entry_id: string;
  field: string;
  error: string;
};

export type IdentityBackfill = {
  from_id: string;
  id: string;
  metadata: Array<{ key: string; value: string }>;
};

export type ValidateResponse = {
  ok: boolean;
  diagnostics?: CandidateDiagnostic[];
  errors?: ValidateError[];
  validation_token?: string;
  candidate_hash?: string;
  identity_backfill?: IdentityBackfill[];
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

export type AccountLabelModel = CategoryModel;

export type AccountLabelCommitPayload = {
  accounts: AccountLabelModel[];
};

export type AccountGroup = "expenses" | "income" | "assets" | "liabilities";

export type AccountDeleteScanReference = {
  kind: string;
  source_file: string;
  source_line: number;
  item_id: string;
  date: string;
  field: string;
  account: string;
};

export type AccountDeleteScanResponse = {
  ok: boolean;
  account: string;
  exists: boolean;
  can_delete: boolean;
  child_accounts: string[];
  references: AccountDeleteScanReference[];
  reference_count: number;
  child_account_count: number;
  error?: string;
};

export type AccountMigrateScanResponse = {
  ok: boolean;
  old_name: string;
  new_name: string;
  affected_files: Array<{ file: string; changes: number }>;
  posting_count: number;
  pad_count: number;
  balance_count: number;
  open_count: number;
  account_count: number;
  child_accounts: string[];
  blocking_diagnostics: CandidateDiagnostic[];
  can_migrate: boolean;
  error?: string;
};

export type AccountMigrateValidateResponse = {
  ok: boolean;
  scan?: AccountMigrateScanResponse;
  validation_token?: string;
  candidate_hash?: string;
  file_count?: number;
  change_count?: number;
  error?: string;
  diagnostics?: CandidateDiagnostic[];
};

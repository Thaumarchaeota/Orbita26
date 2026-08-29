import type { Transaction } from "../domain/ledger-item";
import type { SavePhase } from "../domain/ledger-item";
import type { CsvImportOrder } from "../domain/csv-import";
import type { EntryFieldPatch } from "../state/ledger-store";
import type { CandidateDiagnostic, DetailItem, Entry } from "../types";
import type { FilterableStripeKind } from "./filter-kinds";
import type { SetMatchMode, TypeFilterMode } from "../domain/filter-apply";

export type CardDetailLoadState = "loading" | "partial" | "ready" | "error";

export type CardDetailFilterSnapshot = {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly typeMode: TypeFilterMode;
  readonly types: ReadonlySet<FilterableStripeKind>;
  readonly accounts: ReadonlySet<string>;
  readonly accountMode: SetMatchMode;
  readonly tags: ReadonlySet<string>;
  readonly tagMode: SetMatchMode;
};

export type BalanceAuditSnapshot = {
  readonly loadState: "idle" | "loading" | "ready" | "error";
  readonly error: string | null;
  readonly accounts: readonly AccountStats[];
};

export type CardDetailSnapshot = {
  readonly items: readonly DetailItem[];
  readonly loadState: CardDetailLoadState;
  readonly error: string | null;
  readonly filter: CardDetailFilterSnapshot;
  readonly savePhase: SavePhase;
  readonly isDirty: boolean;
  readonly validationErrors: readonly CandidateDiagnostic[];
  readonly globalValidationErrors: readonly string[];
  readonly globalValidationError: string | null;
  readonly focusRequest: string | null;
  readonly balanceAudit: BalanceAuditSnapshot;
};

export type NewTransactionDraft = Omit<
  Entry,
  "kind" | "id" | "source_file" | "source_line" | "seq"
>;

export type CardDetailCommand =
  | { type: "set-date-from"; value: string }
  | { type: "set-date-to"; value: string }
  | { type: "set-date-range"; from: string; to: string }
  | { type: "set-type-mode"; mode: TypeFilterMode }
  | { type: "toggle-type"; stripeKind: FilterableStripeKind }
  | { type: "set-all-types" }
  | { type: "set-accounts"; accounts: ReadonlySet<string> }
  | { type: "set-account-mode"; mode: SetMatchMode }
  | { type: "set-tags"; tags: ReadonlySet<string> }
  | { type: "set-tag-mode"; mode: SetMatchMode }
  | { type: "reset-filters" }
  | { type: "update-entry"; id: string; patch: EntryFieldPatch }
  | { type: "soft-delete"; id: string }
  | { type: "undo-delete"; id: string }
  | { type: "create-transaction"; draft: NewTransactionDraft }
  | { type: "merge-csv"; drafts: Transaction[]; orderMode: CsvImportOrder }
  | { type: "clear-validation-errors" }
  | { type: "consume-focus" };

export type CardDetailStore = {
  getSnapshot(): CardDetailSnapshot;
  getFilterSnapshot(): CardDetailFilterSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeFilter(listener: () => void): () => void;
  subscribeRendered(listener: () => void): () => void;
  dispatch(command: CardDetailCommand): void;
  handleSave(): Promise<void>;
  revertAllEdits(): boolean;
  consumeMergeFocus(): string;
  setCommitEdit?(fn: () => void): void;
  setDismissEdit?(fn: () => void): void;
  dispose(): void;
  tryLoadOlder?: () => Promise<void>;
  onAfterCommit?: (fn: () => void) => () => void;
};

import type { FinanceSearchHighlight } from "./finance-search";

export type CardDetailHandle = {
  getScrollTargets(): { primary: HTMLElement; secondary?: HTMLElement };
  focusItem(id: string): void;
  refresh(): void;
  setSearchHighlight(highlight: FinanceSearchHighlight | null): void;
  animateCommitRemovals(ids: string[]): Promise<void>;
  dispose(): void;
};

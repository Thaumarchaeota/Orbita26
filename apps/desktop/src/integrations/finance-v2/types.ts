/** UI-facing projection of the isolated Finance v2 contracts. These are not Tauri wire DTOs. */
export type FinanceAccountKind = "Assets" | "Liabilities" | "Equity" | "Income" | "Expenses";
export type ExactQuantityView = { amount: string; commodity: string };
export type FinanceAccountView = {
  id: string; revision: number; name: string; kind: FinanceAccountKind;
  beanPath: string | null; parentId: string | null; active: boolean; everUsed: boolean;
};
export type FinanceViaView = { id: string; revision: number; name: string; active: boolean };
export type FinanceFactView = {
  id: string; revision: number; status: "Active" | "Deleted" | "Refined";
  effectiveDate: string; businessTime: { kind: "Date"; sourceDate: string } | { kind: "Instant"; utcMicros: string; sourceDate: string | null };
  positiveAccountId: string; positive: ExactQuantityView; negativeAccountId: string; negative: ExactQuantityView;
  viaId: string | null; title: string; notes: string; provenance: { kind: "Manual"; createdAtUtcMicros: string } | { kind: "Imported"; evidenceIds: string[] };
};
export type FinanceAccountBindingView = { accountId: string | null; viaId: string | null; accountRevision: number | null; viaRevision: number | null };
export type FinanceAccountViaView = { accountId: string; viaId: string; revision: number; active: boolean };
export type FinanceCalibrationPointView = {
  id: string; revision: number; accountId: string; businessDate: string;
  quantity: ExactQuantityView; status: "Active" | "Deleted"; recordedAtUtcMicros: number;
};
export type FinanceObservationFieldView = { role: string; rawText: string | null; value: { kind: "SignedQuantity"; quantity: ExactQuantityView } | { kind: "Date"; value: string } | { kind: "Text"; value: string } | { kind: "Missing" }; binding: FinanceAccountBindingView | null };
export type FinanceParsedObservationView = {
  artifactId: string; artifactSha256: string; artifactByteLength: number; contractId: string; contractRevision: string;
  contextId: string; contextRevision: number; contextProvider: string;
  profileId: string; profileRevision: string; bindingRevision: number; locator: string; occurrenceDiscriminator: string;
  sourceRow: { artifactId: string; locator: string; occurrenceDiscriminator: string; profileId: string; profileRevision: string; rawTextVersion: number; rawText: string };
  fields: FinanceObservationFieldView[]; quality: "Confirmed" | { unresolved: string } | { failed: string };
};
export type FinanceWorkspaceLeftRowView = {
  itemId: string; itemRevision: number; manualCategoryRevision: number; stillInLeft: boolean;
  disposition: "Open" | "Staged" | "Rejected" | "Cancelled"; quality: FinanceParsedObservationView["quality"];
  category: FinanceAccountBindingView | null; categoryOrigin: "SourceBinding" | "Human" | { ai: { model: string; requestRevision: number } } | null;
  observation: FinanceParsedObservationView;
};
export type FinanceWorkspaceRightPreviewView = {
  intentId: string; kind: "CreateFact" | "AmendFact" | "DeleteFact" | "RestoreFact" | "EvidenceMatch" | "Treatment" | "Refinement" | "CandidateConfirmation";
  sourceItemIds: string[]; memberIds: Array<{ l0Id: string; revision: number }>;
  baseGeneration: number; confirmed: boolean; blockingReasons: string[]; projectedFacts: FinanceFactView[];
};
export type FinanceCandidateView = { key: string; observation: { artifactId: string; locator: string; occurrenceDiscriminator: string; accountId: string }; kind: "Direct" | "Combination"; members: Array<{ l0Id: string; revision: number }>; signedQuantity: ExactQuantityView; sourceRole: string; intentRole: string; reason: unknown; stale: boolean; confirmed: boolean };
export type FinanceWorkspaceReadModel = {
  ledgerGeneration: number; draftRevision: number; durableRevision: number; dirty: boolean; stale: boolean;
  undoOperationId: string | null;
  status: "Editing" | "ImportCancelled" | { prepared: { operationId: string } } | { committed: { operationId: string; receiptId: string } } | "Abandoned";
  leftRows: FinanceWorkspaceLeftRowView[]; rightPreview: FinanceWorkspaceRightPreviewView[];
  candidates: FinanceCandidateView[]; candidateCoverage: { complete: { expansionNodes: number } } | { budgetExhausted: { expansionNodes: number; limit: number; nextScope: string } } | null;
  unresolvedCandidateObservations: string[];
};
export type FinanceManualChange = { changedAtUtcMicros: string; reason: string };
export type FinanceTreatmentView = { id: string; revision: number; ownerL0Id: string; members: Array<{ l0Id: string; revision: number }>; mergeGroups: Array<{ members: Array<{ l0Id: string; revision: number }> }>; refundEdges: Array<{ refund: { l0Id: string; revision: number }; payment: { l0Id: string; revision: number }; amount: ExactQuantityView }>; title: string; notes: string };
export type FinanceIntentPayload =
  | { fact: { create: { fact: FinanceFactView } } | { amend: { expected: { l0Id: string; revision: number }; fact: FinanceFactView; manualChange: FinanceManualChange } } | { delete: { expected: { l0Id: string; revision: number }; deletedVersion: FinanceFactView; manualChange: FinanceManualChange } } | { restore: { expectedRevision: number; restoredVersion: FinanceFactView; manualChange: FinanceManualChange } } }
  | { evidenceMatch: { artifactId: string; locator: string; occurrenceDiscriminator: string; observedAccountId: string; sourceRole: string; groupingKind: "Ordinary" | "Refinement"; requiresRefundTreatment: boolean; signedQuantity: ExactQuantityView; sign: "Positive" | "Negative"; members: Array<{ member: { l0Id: string; revision: number }; sign: "Positive" | "Negative"; allocation: ExactQuantityView | null }> } }
  | { treatment: { apply: { treatment: FinanceTreatmentView } } | { amend: { expectedRevision: number; treatment: FinanceTreatmentView; manualChange: FinanceManualChange } } | { release: { expectedRevision: number; tombstone: FinanceTreatmentView; manualChange: FinanceManualChange } } }
  | { refinement: unknown }
  | { candidateConfirmation: { candidateKey: string } };
export type FinanceRefinementInput = {
  parentId: string; parentRevision: number; children: FinanceFactView[];
  evidenceAllocations: Array<{
    source: { artifactId: string; locator: string; occurrenceDiscriminator: string; accountId: string; signedQuantity: ExactQuantityView; sign: "Positive" | "Negative"; role: string };
    pieces: Array<{ childId: string; childRevision: number; sign: "Positive" | "Negative"; allocated: ExactQuantityView }>;
  }>;
  treatmentResolutions: Array<{ replace: { oldTreatmentId: string; oldRevision: number; replacement: FinanceTreatmentView } } | { dissolve: { oldTreatmentId: string; oldRevision: number; resultingTreatments: FinanceTreatmentView[] } }>;
};

/** Returned only by explicit create/open. Every command also revalidates the marker server-side. */
export type IsolatedFinanceSession = {
  sessionId: string; rootPath: string; workspaceId: string; ledgerIdentity: string;
  markerVersion: number; scope: "isolated"; generation: number;
};
export type FinanceSnapshotView = {
  generation: number; accountViaMappingRevision: number;
  accountViaBindings: FinanceAccountViaView[];
  accounts: FinanceAccountView[]; vias: FinanceViaView[]; facts: FinanceFactView[]; treatments: FinanceTreatmentView[]; calibrations: FinanceCalibrationPointView[]; restorableFacts: FinanceFactView[];
};
export type FinanceSourceContextView = { id: string; revision: number; label: string; provider: string; scope: string; dateSemantics: string; active: boolean };
export type FinanceSourceView = { id: string; revision: number; contextId: string; contextRevision: number; profileId: string; profileRevision: string; fieldAlias: string; sourceHint: string | null; accountId: string | null; viaId: string | null; active: boolean; bindingRevision: number };
export type FinanceManagementSaveResult<T> = {
  entity: T; generation: number; receiptId: string; operationId: string; materializationJobId: string;
  materializationStatus: "pending" | "running" | "ready" | "failed"; materializationError?: string;
};
export const FINANCE_V2_SOURCE_PROFILES = [
  { id: "wallet-csv-13/v1", label: "Wallet CSV (13 columns)" },
  { id: "wallet-xlsx-11/v1", label: "Wallet XLSX (11 columns)" },
  { id: "credit-card-pdf-text-6/v1", label: "信用卡账单 PDF 文本" },
  { id: "cmb-bank-pdf-text-6/v1", label: "招商银行 PDF 文本" },
  { id: "boc-bank-pdf-text-12/v1", label: "中国银行 PDF 表格文本" },
] as const;
export type ParseQualityView = "Confirmed" | { unresolved: string } | { failed: string };
export type FinanceImportRowView = {
  itemId: string; itemRevision: number; manualCategoryRevision: number; locator: string;
  merchant: string; summary: string; notes: string; amountText: string; commodity: string;
  quality: ParseQualityView; categoryId: string | null; categoryKind: "Expense" | "Income" | null;
  categoryViaId?: string | null; categoryAccountRevision?: number | null; categoryViaRevision?: number | null;
  stillLeft: boolean; manuallyEdited: boolean; rawText?: string;
};
export type FinanceImportBatchView = { draftId: string; draftRevision: number; durableRevision: number; baseGeneration: number; rows: FinanceImportRowView[]; observations?: FinanceParsedObservationView[]; accountViaMappingRevision?: number; capturedAccountViaBindings?: FinanceAccountViaView[]; contextId?: string; contextRevision?: number; profileId?: string; manualOnly?: boolean };
export type FinanceReportView = {
  generation: number;
  transactions: Array<{ businessDate: string; title: string; notes: string; owner: unknown; sourceFacts: unknown[]; leg: unknown; postings: Array<{ account: unknown; quantity: ExactQuantityView; totalPrice: ExactQuantityView | null }> }>;
  dailyBalances: Array<{ date: string; accountId: string; commodity: string; amount: string | null; basis: "TransactionDerived" | "CalibrationAnchored" | "UnknownNoCalibration"; calibrationPointIds: string[] }>;
  incomeExpenseTotals: Array<{ date: string; accountId: string; kind: "Income" | "Expenses"; quantity: ExactQuantityView }>;
  settlementTotals: Array<{ date: string; accountId: string; kind: "Income" | "Expenses"; quantity: ExactQuantityView }>;
  calibrationDeltas: Array<{ accountId: string; commodity: string; effectiveDate: string; beanBalanceDate: string; amount: ExactQuantityView; expectedBefore: ExactQuantityView; observed: ExactQuantityView }>;
};
export type FinanceHistoryRowView = { id: string; revision: number; recordedAt: string; entity: string; field: string; before: string; after: string; provenance: string; relationChange?: string };
export type FinanceHistoryEntityKind = "account" | "via" | "l0" | "treatment" | "calibration" | "source_context" | "source_binding" | "evidence_link";
export type FinanceDraftStatusView = { draftId: string | null; revision: number; durableRevision: number; commitState: "Unprepared" | "Prepared" | "Committed"; operationId?: string; receiptId?: string; generation: number; pendingMaterialization?: string; manualOnly?: boolean; draftState?: FinanceDraftListEntryView["state"] };
export type FinanceDraftListEntryView = {
  draftId: string;
  workspaceKind: "Imported" | "ManualOnly";
  durableRevision: number;
  state: "Open" | "Prepared" | "Committed" | "Finalized" | "Abandoned" | "Corrupt";
  operationId?: string;
  receiptId?: string;
  updatedAtUtcUs?: string | number | null;
};
export type FinanceRuleView = { content: string; revision: number; sha256: string };
export type FinanceRuleAppendPreview = { baseRevision: number; baseSha256: string; previewContent: string; appendSha256: string; appendText: string };
export type FinanceAiModelView = { modelId: string | null; revision: number };

export type ClassificationRequest = {
  item_id: string; expected_item_revision: number; expected_manual_category_revision: number;
  merchant: string; summary: string; notes: string; amount_text: string; commodity: string;
};
export type ClassificationResult = {
  item_id: string; expected_item_revision: number; expected_manual_category_revision: number;
  account_id: string; account_revision: number;
};
export type FinanceAiCategorySuggestion = {
  itemId: string; expectedItemRevision: number; expectedManualCategoryRevision: number;
  accountId: string; accountRevision: number; model: string;
};
export type FinanceAiApplyResult = { itemId: string; applied: boolean; reason: string | null };

export type FinancePage = "overview" | "management" | "import" | "workspace" | "history" | "rules" | "recovery" | "reports";

/** Page/client boundary. Methods express UI capabilities only; backend owns Tauri commands and wire DTOs. */
export interface FinanceV2Backend {
  pickEnvironmentDirectory(): Promise<string | null>;
  createEnvironment(parentPath: string): Promise<IsolatedFinanceSession>;
  openEnvironment(rootPath: string): Promise<IsolatedFinanceSession>;
  closeIsolatedSession(session: IsolatedFinanceSession): Promise<void>;
  loadSnapshot(session: IsolatedFinanceSession): Promise<FinanceSnapshotView>;
  loadSourceContexts(session: IsolatedFinanceSession): Promise<FinanceSourceContextView[]>;
  saveSourceContext(session: IsolatedFinanceSession, input: Omit<FinanceSourceContextView, "revision"> & { id: string; expectedRevision?: number }): Promise<FinanceManagementSaveResult<FinanceSourceContextView>>;
  loadSources(session: IsolatedFinanceSession, contextId?: string, profileId?: string): Promise<FinanceSourceView[]>;
  saveSource(session: IsolatedFinanceSession, input: Omit<FinanceSourceView, "bindingRevision"> & { expectedRevision?: number }): Promise<FinanceManagementSaveResult<FinanceSourceView>>;
  saveAccount(session: IsolatedFinanceSession, input: Omit<FinanceAccountView, "revision" | "everUsed"> & { expectedRevision?: number }): Promise<FinanceManagementSaveResult<FinanceAccountView>>;
  saveVia(session: IsolatedFinanceSession, input: Omit<FinanceViaView, "revision"> & { expectedRevision?: number }): Promise<FinanceManagementSaveResult<FinanceViaView>>;
  saveCalibration(session: IsolatedFinanceSession, input: { id: string; accountId: string; businessDate: string; quantity: ExactQuantityView; expectedRevision?: number }): Promise<FinanceManagementSaveResult<FinanceCalibrationPointView>>;
  deleteCalibration(session: IsolatedFinanceSession, id: string, expectedRevision: number): Promise<FinanceManagementSaveResult<FinanceCalibrationPointView>>;
  restoreCalibration(session: IsolatedFinanceSession, id: string, expectedRevision: number, sourceRevision: number): Promise<FinanceManagementSaveResult<FinanceCalibrationPointView>>;
  setAccountViaBinding(session: IsolatedFinanceSession, accountId: string, viaId: string, active: boolean, expectedRevision?: number): Promise<FinanceManagementSaveResult<FinanceAccountViaView>>;
  setAccountActive(session: IsolatedFinanceSession, accountId: string, expectedRevision: number, active: boolean): Promise<FinanceManagementSaveResult<FinanceAccountView>>;
  pickAndParse(session: IsolatedFinanceSession, contextId: string, expectedContextRevision: number, profileId: string, onProgress: (message: string) => void, signal: AbortSignal): Promise<FinanceImportBatchView>;
  confirmParsedBatch(session: IsolatedFinanceSession, batch: FinanceImportBatchView, acceptedItemIds: string[]): Promise<FinanceImportBatchView>;
  createManualWorkspace(session: IsolatedFinanceSession): Promise<FinanceImportBatchView>;
  applyAiCategorySuggestions(session: IsolatedFinanceSession, draftId: string, suggestions: FinanceAiCategorySuggestion[]): Promise<FinanceAiApplyResult[]>;
  readWorkspace(session: IsolatedFinanceSession, draftId: string): Promise<FinanceWorkspaceReadModel>;
  persistWorkspace(session: IsolatedFinanceSession, draftId: string): Promise<FinanceDraftStatusView>;
  listRestorableFacts(session: IsolatedFinanceSession): Promise<FinanceFactView[]>;
  setManualCategory(session: IsolatedFinanceSession, draftId: string, itemId: string, expectedItemRevision: number, category: FinanceAccountBindingView | null, changedAtUtcMicros: string): Promise<void>;
  rejectObservation(session: IsolatedFinanceSession, draftId: string, itemId: string, expectedItemRevision: number): Promise<void>;
  cancelObservation(session: IsolatedFinanceSession, draftId: string, itemId: string, expectedItemRevision: number): Promise<void>;
  stageWorkspaceIntent(session: IsolatedFinanceSession, draftId: string, payload: FinanceIntentPayload, sourceItemIds: string[]): Promise<string>;
  stageWorkspaceRefinement(session: IsolatedFinanceSession, draftId: string, input: FinanceRefinementInput, sourceItemIds: string[]): Promise<string>;
  undoWorkspaceAction(session: IsolatedFinanceSession, draftId: string, operationId: string): Promise<void>;
  cancelWorkspaceImport(session: IsolatedFinanceSession, draftId: string): Promise<void>;
  confirmWorkspaceCandidate(session: IsolatedFinanceSession, draftId: string, candidateKey: string): Promise<void>;
  saveDraft(session: IsolatedFinanceSession, batch: FinanceImportBatchView): Promise<FinanceDraftStatusView>;
  loadDraftStatus(session: IsolatedFinanceSession): Promise<FinanceDraftStatusView>;
  listDrafts(session: IsolatedFinanceSession): Promise<FinanceDraftListEntryView[]>;
  listHistory(session: IsolatedFinanceSession, entityKind: FinanceHistoryEntityKind, entityId: string): Promise<FinanceHistoryRowView[]>;
  loadRules(session: IsolatedFinanceSession): Promise<FinanceRuleView>;
  saveRules(session: IsolatedFinanceSession, expectedRevision: number, expectedSha256: string, content: string): Promise<FinanceRuleView>;
  previewAppendRules(session: IsolatedFinanceSession, appendContent: string): Promise<FinanceRuleAppendPreview>;
  confirmAppendRules(session: IsolatedFinanceSession, preview: FinanceRuleAppendPreview): Promise<FinanceRuleView>;
  openRulesFile(session: IsolatedFinanceSession): Promise<void>;
  loadFinanceAiModel(session: IsolatedFinanceSession): Promise<FinanceAiModelView>;
  saveFinanceAiModel(session: IsolatedFinanceSession, expectedRevision: number, modelId: string): Promise<FinanceAiModelView>;
  prepareCommit(session: IsolatedFinanceSession, batch: FinanceImportBatchView): Promise<{ errors: string[]; status: FinanceDraftStatusView }>;
  commitPrepared(session: IsolatedFinanceSession, batch: FinanceImportBatchView): Promise<FinanceDraftStatusView>;
  retryMaterialization(session: IsolatedFinanceSession, operationId: string): Promise<FinanceDraftStatusView>;
  abandonUnsubmittedDraft(session: IsolatedFinanceSession, draftId: string): Promise<void>;
  loadReports(session: IsolatedFinanceSession): Promise<FinanceReportView>;
}

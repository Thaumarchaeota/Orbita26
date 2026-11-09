import {
  buildTravelEnvelope,
  newTravelRequestId,
  productivityTravelV2AdoptFlight,
  productivityTravelV2Append,
  productivityTravelV2Cancel,
  productivityTravelV2ClearPoint,
  productivityTravelV2Create,
  productivityTravelV2DeleteCheckpoint,
  productivityTravelV2DeleteStage,
  productivityTravelV2DeleteTrip,
  productivityTravelV2EditPlan,
  productivityTravelV2ReplayPlanEffect,
  productivityTravelV2ReleasePlanHistory,
  productivityTravelV2Finish,
  productivityTravelV2Reopen,
  productivityTravelV2Get,
  productivityTravelV2GetReceipt,
  productivityTravelV2QueryFlight,
  newTravelMemberId,
  productivityTravelV2Restore,
  productivityTravelV2RestoreAdoptionFields,
  productivityTravelV2SetActual,
  productivityTravelV2SetCheckpointCompleted,
  productivityTravelV2SetJoinActual,
  productivityTravelV2Split,
} from "./client";
import type {
  TravelAdoptFlightPayload,
  TravelAdoptFlightResult,
  TravelAppendPayload,
  TravelCancelPayload,
  TravelCommandEnvelope,
  TravelCreatePayload,
  TravelDeleteCheckpointPayload,
  TravelDeleteStagePayload,
  TravelDomainError,
  TravelEditPlanPayload,
  TravelEditingSelection,
  TravelMutationResult,
  TravelPlanCommitOutcome,
  TravelPlanHistoryScope,
  TravelQueryFlightContext,
  TravelQueryFlightResult,
  TravelRestoreAdoptionFieldsPayload,
  TravelRestoreBaseline,
  TravelRestorePayload,
  TravelSaveState,
  TravelSetActualPayload,
  TravelSetCheckpointCompletedPayload,
  TravelTextDraftKey,
  TravelTransportationPatch,
  TravelUpdateItemPayload,
  TravelUpdatePointPayload,
  TripSnapshot,
} from "./types";

export type TravelControllerListener = (state: TravelControllerState) => void;

export type TravelErrorKind = "conflict" | "generic";

export type TravelDirtyDraft = {
  itemId: string;
  key: TravelTextDraftKey;
  value: string | null;
};

export type TravelFailedCommit = {
  itemId: string;
  requestId: string;
  fieldKey?: TravelTextDraftKey;
  draftValue: string | null;
  errorKind: TravelErrorKind;
  message: string;
};

export type TravelControllerState = {
  contextEpoch: number;
  expectedDataDir: string;
  currentSnapshot: TripSnapshot | null;
  editingSelection: TravelEditingSelection;
  saveState: TravelSaveState;
  planEditGeneration: number;
  queryGeneration: number;
  restoreBaseline: TravelRestoreBaseline | null;
  lastError: TravelDomainError | string | null;
  lastErrorKind: TravelErrorKind | null;
  pendingDraftCount: number;
  queueDepth: number;
  failedCommitCount: number;
};

type PendingMutation = {
  requestId: string;
  itemId: string;
  contextEpoch: number;
  expectedDataDir: string;
  fieldKey?: TravelTextDraftKey;
  draftValue?: string | null;
  sent: boolean;
  planCompletion?: (outcome: TravelPlanCommitOutcome) => void;
  planGeneration?: number;
  historyScope?: TravelPlanHistoryScope;
  run: () => Promise<TravelMutationResult | TravelAdoptFlightResult>;
};

type ItemQueue = {
  pending: PendingMutation[];
  inflight: PendingMutation | null;
};

type FailedMutationRecord = TravelFailedCommit & {
  mutation: PendingMutation;
};

type DraftFields = Map<TravelTextDraftKey, string | null>;

export type TravelControllerOptions = {
  expectedDataDir: string;
  /** Host session identity + epoch + destination instance, per SPEC-0015. */
  historyScope?: TravelPlanHistoryScope;
  onStateChange?: TravelControllerListener;
  /** Called after a mutation applies a fresh snapshot (productivity reload hook for hosts). */
  onSnapshotCommitted?: (snapshot: TripSnapshot, itemId: string) => void;
};

/**
 * Owns trip editing session state per travel-item-storage §9 and SPEC-0007 §8.
 * Serial per-item mutation queue; does not auto-query flights.
 */
export class TravelController {
  private expectedDataDir: string;
  private contextEpoch = 0;
  private currentSnapshot: TripSnapshot | null = null;
  private editingSelection: TravelEditingSelection = null;
  private saveState: TravelSaveState = "clean";
  private planEditGeneration = 0;
  private queryGeneration = 0;
  private restoreBaseline: TravelRestoreBaseline | null = null;
  private lastError: TravelDomainError | string | null = null;
  private lastErrorKind: TravelErrorKind | null = null;
  private readonly failedCommits: FailedMutationRecord[] = [];
  private readonly perItemQueues = new Map<string, ItemQueue>();
  private readonly snapshotByItemId = new Map<string, TripSnapshot>();
  private readonly draftFields = new Map<string, DraftFields>();
  private readonly onStateChange?: TravelControllerListener;
  private readonly onSnapshotCommitted?: (snapshot: TripSnapshot, itemId: string) => void;
  private disposed = false;
  private historyScope?: TravelPlanHistoryScope;
  private planHistoryFrozen = false;
  private readonly historySequences = new Map<string, number>();
  private readonly deliveredPlanRequests = new Set<string>();
  private historyReleaseTail: Promise<void> = Promise.resolve();
  private planHistoryResetGeneration = 0;

  constructor(options: TravelControllerOptions) {
    this.expectedDataDir = options.expectedDataDir.trim();
    this.historyScope = options.historyScope ? { ...options.historyScope } : undefined;
    this.onStateChange = options.onStateChange;
    this.onSnapshotCommitted = options.onSnapshotCommitted;
    this.emit();
  }

  dispose(): void {
    this.releasePlanHistory();
    for (const queue of this.perItemQueues.values()) for (const entry of queue.pending) entry.planCompletion?.({ status: "cancelled", requestId: entry.requestId });
    this.disposed = true;
    this.perItemQueues.clear();
    this.snapshotByItemId.clear();
    this.draftFields.clear();
    this.failedCommits.length = 0;
    this.currentSnapshot = null;
    this.editingSelection = null;
    this.restoreBaseline = null;
  }

  getState(): TravelControllerState {
    return {
      contextEpoch: this.contextEpoch,
      expectedDataDir: this.expectedDataDir,
      currentSnapshot: this.currentSnapshot,
      editingSelection: this.editingSelection,
      saveState: this.saveState,
      planEditGeneration: this.planEditGeneration,
      queryGeneration: this.queryGeneration,
      restoreBaseline: this.restoreBaseline,
      lastError: this.lastError,
      lastErrorKind: this.lastErrorKind,
      pendingDraftCount: this.countDrafts(),
      queueDepth: this.countQueued(),
      failedCommitCount: this.failedCommits.length,
    };
  }

  isLastErrorConflict(): boolean {
    return this.lastErrorKind === "conflict";
  }

  getDirtyDrafts(): TravelDirtyDraft[] {
    const out: TravelDirtyDraft[] = [];
    for (const [itemId, drafts] of this.draftFields) {
      for (const [key, value] of drafts) {
        out.push({ itemId, key, value });
      }
    }
    return out;
  }

  getFailedCommits(): TravelFailedCommit[] {
    return this.failedCommits.map(({ mutation: _m, ...rest }) => rest);
  }

  retryFailed(itemId?: string): void {
    const toRetry = itemId
      ? this.failedCommits.filter((f) => f.itemId === itemId)
      : [...this.failedCommits];
    if (!toRetry.length) return;
    for (const failed of toRetry) {
      const index = this.failedCommits.findIndex((f) => f.requestId === failed.requestId);
      if (index >= 0) this.failedCommits.splice(index, 1);
      const queue = this.ensureQueue(failed.itemId);
      const retryMutation: PendingMutation = {
        ...failed.mutation,
        contextEpoch: this.contextEpoch,
        expectedDataDir: this.expectedDataDir,
        sent: false,
      };
      if (failed.fieldKey != null) {
        this.setTextDraft(failed.itemId, failed.fieldKey, failed.draftValue);
      }
      queue.pending.push(retryMutation);
      void this.pumpQueue(failed.itemId);
    }
    this.lastError = null;
    this.lastErrorKind = null;
    if (this.saveState === "failed" || this.saveState === "conflict") {
      this.saveState = this.countDrafts() > 0 || this.countQueued() > 0 ? "dirty" : "clean";
    }
    this.emit();
  }

  setExpectedDataDir(next: string): void {
    const trimmed = next.trim();
    if (trimmed === this.expectedDataDir) return;
    this.releasePlanHistory();
    this.planHistoryFrozen = false;
    this.expectedDataDir = trimmed;
    this.bumpContextEpoch();
    this.cancelUnsentForAllItems();
    this.snapshotByItemId.clear();
    this.currentSnapshot = null;
    this.editingSelection = null;
    this.restoreBaseline = null;
    this.saveState = "clean";
    this.lastError = null;
    this.lastErrorKind = null;
    this.failedCommits.length = 0;
    this.emit();
  }

  setEditingSelection(selection: TravelEditingSelection): void {
    const previousItemId = this.editingSelection?.itemId ?? null;
    const nextItemId = selection?.itemId ?? null;
    if (previousItemId !== nextItemId) {
      this.restoreBaseline = null;
    }
    this.editingSelection = selection;
    this.emit();
  }

  bumpPlanEditGeneration(): number {
    this.planEditGeneration += 1;
    this.emit();
    return this.planEditGeneration;
  }

  getPlanEditGeneration(): number {
    return this.planEditGeneration;
  }

  bumpQueryGeneration(): number {
    this.queryGeneration += 1;
    this.emit();
    return this.queryGeneration;
  }

  setRestoreBaseline(baseline: TravelRestoreBaseline | null): void {
    this.restoreBaseline = baseline;
    this.emit();
  }

  clearRestoreBaseline(): void {
    this.restoreBaseline = null;
    this.emit();
  }

  /**
   * Apply snapshot from host reload or successful mutation. Drops stale dataDir/epoch/revision.
   */
  acceptSnapshot(snapshot: TripSnapshot, meta: { expectedDataDir: string; contextEpoch: number; minItemRevision?: number }): boolean {
    if (this.disposed) return false;
    if (meta.expectedDataDir.trim() !== this.expectedDataDir) return false;
    if (meta.contextEpoch !== this.contextEpoch) return false;
    if (meta.minItemRevision != null && snapshot.item.revision < meta.minItemRevision) return false;
    const itemId = snapshot.item.id;
    const known = this.snapshotByItemId.get(itemId);
    if (known && known.item.revision > snapshot.item.revision) return false;
    this.snapshotByItemId.set(itemId, snapshot);
    this.currentSnapshot = snapshot;
    if (this.saveState !== "saving" && this.countQueued() === 0 && this.countDrafts() === 0) {
      this.saveState = "clean";
    }
    this.emit();
    return true;
  }

  async loadTrip(itemId: string): Promise<TripSnapshot> {
    const loadEpoch = this.contextEpoch;
    const loadDir = this.expectedDataDir;
    const snapshot = await productivityTravelV2Get({ itemId, expectedDataDir: loadDir });
    if (this.disposed || loadEpoch !== this.contextEpoch || loadDir !== this.expectedDataDir) {
      throw new Error("travel context changed during load");
    }
    if (this.currentSnapshot?.item.id !== itemId) {
      this.restoreBaseline = null;
    }
    this.snapshotByItemId.set(itemId, snapshot);
    this.currentSnapshot = snapshot;
    this.saveState = "clean";
    this.lastError = null;
    this.lastErrorKind = null;
    this.emit();
    return snapshot;
  }

  getDraft(itemId: string, key: TravelTextDraftKey): string | null | undefined {
    return this.draftFields.get(itemId)?.get(key);
  }

  setTextDraft(itemId: string, key: TravelTextDraftKey, value: string | null): void {
    let itemDrafts = this.draftFields.get(itemId);
    if (!itemDrafts) {
      itemDrafts = new Map();
      this.draftFields.set(itemId, itemDrafts);
    }
    itemDrafts.set(key, value);
    if (this.saveState === "clean") this.saveState = "dirty";
    this.emit();
  }

  clearTextDraft(itemId: string, key: TravelTextDraftKey): void {
    this.draftFields.get(itemId)?.delete(key);
    this.emit();
  }

  /** Queue a text field commit; merges with unsent queue entry for the same fieldKey. */
  queueTextCommit(
    itemId: string,
    fieldKey: TravelTextDraftKey,
    buildPayload: (value: string | null) => TravelUpdateItemPayload | TravelUpdatePointPayload | TravelTransportationPatch,
    invoke: (
      envelope: TravelCommandEnvelope<TravelUpdateItemPayload | TravelUpdatePointPayload | TravelTransportationPatch>,
    ) => Promise<TravelMutationResult>,
  ): void {
    const itemDrafts = this.draftFields.get(itemId);
    const draftValue = itemDrafts?.has(fieldKey) ? (itemDrafts.get(fieldKey) ?? null) : null;
    const queue = this.ensureQueue(itemId);
    const textCommitRun =
      (requestId: string, sendValue: string | null) =>
      () =>
        this.runMutation(itemId, requestId, () =>
          invoke(
            buildTravelEnvelope(this.expectedDataDir, this.snapshotForItem(itemId), buildPayload(sendValue), { requestId }),
          ),
        );
    if (!queue.inflight) {
      const mergeIndex = queue.pending.findIndex((entry) => !entry.sent && entry.fieldKey === fieldKey);
      if (mergeIndex >= 0) {
        const existing = queue.pending[mergeIndex];
        const mergedValue = itemDrafts?.has(fieldKey) ? (itemDrafts.get(fieldKey) ?? null) : (existing.draftValue ?? draftValue);
        queue.pending[mergeIndex] = {
          ...existing,
          draftValue: mergedValue,
          run: textCommitRun(existing.requestId, mergedValue),
        };
        this.saveState = "dirty";
        this.emit();
        this.pumpQueue(itemId);
        return;
      }
    }
    const requestId = newTravelRequestId();
    queue.pending.push({
      requestId,
      itemId,
      contextEpoch: this.contextEpoch,
      expectedDataDir: this.expectedDataDir,
      fieldKey,
      draftValue,
      sent: false,
      run: textCommitRun(requestId, draftValue),
    });
    this.saveState = "dirty";
    this.emit();
    this.pumpQueue(itemId);
  }

  enqueueMutation<TPayload>(
    itemId: string,
    build: (ctx: { requestId: string; snapshot: TripSnapshot | null; expectedDataDir: string }) => TravelCommandEnvelope<TPayload>,
    invoke: (envelope: TravelCommandEnvelope<TPayload>) => Promise<TravelMutationResult | TravelAdoptFlightResult>,
    options?: { fieldKey?: TravelTextDraftKey; allowMerge?: boolean; planCompletion?: (outcome: TravelPlanCommitOutcome) => void; planGeneration?: number; historyScope?: TravelPlanHistoryScope },
  ): void {
    const queue = this.ensureQueue(itemId);
    const requestId = newTravelRequestId();
    const entry: PendingMutation = {
      requestId,
      itemId,
      contextEpoch: this.contextEpoch,
      expectedDataDir: this.expectedDataDir,
      fieldKey: options?.fieldKey,
      sent: false,
      planCompletion: options?.planCompletion,
      planGeneration: options?.planGeneration,
      historyScope: options?.historyScope,
      run: () =>
        this.runMutation(itemId, requestId, () =>
          invoke(build({ requestId, snapshot: this.snapshotForItem(itemId), expectedDataDir: this.expectedDataDir })),
        ),
    };
    if (options?.allowMerge && options.fieldKey && !queue.inflight) {
      const mergeIndex = queue.pending.findIndex((p) => !p.sent && p.fieldKey === options.fieldKey);
      if (mergeIndex >= 0) {
        queue.pending[mergeIndex] = entry;
        this.saveState = "dirty";
        this.emit();
        this.pumpQueue(itemId);
        return;
      }
    }
    queue.pending.push(entry);
    this.saveState = "dirty";
    this.emit();
    this.pumpQueue(itemId);
  }

  async createTrip(payload: TravelCreatePayload): Promise<TravelMutationResult> {
    const requestId = newTravelRequestId();
    const epoch = this.contextEpoch;
    const dir = this.expectedDataDir;
    this.saveState = "saving";
    this.emit();
    try {
      const result = await productivityTravelV2Create({
        requestId,
        expectedDataDir: dir,
        itemRef: null,
        actionRefs: [],
        checkpointRefs: [],
        payload,
      });
      this.applyMutationResult(result, { itemId: result.snapshot.item.id, requestId, epoch, dir });
      return result;
    } catch (error) {
      this.handleMutationError(error);
      throw error;
    }
  }

  queueAppend(itemId: string, payload: TravelAppendPayload): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2Append);
  }

  queueEditPlan(itemId: string, payload: TravelEditPlanPayload): Promise<TravelPlanCommitOutcome> {
    const generation = payload.edit.kind === "setBoundary" ||
      payload.edit.kind === "setSharedBoundary" ||
      payload.edit.kind === "moveCheckpoint" ||
      payload.edit.kind === "setRange"
      ? payload.edit.planEditGeneration
      : this.planEditGeneration;
    if (this.disposed || generation !== this.planEditGeneration) return Promise.resolve({ status: "cancelled" });
    if (this.planHistoryFrozen) return Promise.resolve({ status: "uncertain", error: "计划结果待核实" });
    const scope = payload.historyScope ?? this.historyScope;
    if (scope && this.historyScope && (scope.ownerId !== this.historyScope.ownerId || scope.hostEpoch !== this.historyScope.hostEpoch)) {
      return Promise.resolve({ status: "failed", error: "撤销记录不属于当前安排实例" });
    }
    if (scope && !this.historyScope) this.historyScope = { ...scope };
    const captured: TravelEditPlanPayload = structuredClone({ ...payload, ...(scope ? { historyScope: { ...scope } } : {}) });
    return new Promise((planCompletion) => this.enqueueMutation(itemId,
      ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, captured, { requestId }),
      productivityTravelV2EditPlan, { planCompletion, planGeneration: generation, historyScope: scope }));
  }

  queueReplayPlanEffect(itemId: string, token: string, direction: "undo" | "redo"): Promise<TravelPlanCommitOutcome> {
    const scope = this.historyScope;
    if (this.disposed || !scope) return Promise.resolve({ status: "cancelled" });
    if (this.planHistoryFrozen) return Promise.resolve({ status: "uncertain", error: "计划结果待核实" });
    return new Promise((planCompletion) => this.enqueueMutation(itemId,
      ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, { token, direction, scope }, { requestId }),
      (envelope) => {
        if (!envelope.itemRef) throw new Error("no current trip refs");
        return productivityTravelV2ReplayPlanEffect({ expectedDataDir: envelope.expectedDataDir, requestId: envelope.requestId,
          historyOwnerId: scope.ownerId, hostEpoch: scope.hostEpoch, planHistoryToken: token, direction,
          currentTripRefs: { item: envelope.itemRef, actions: envelope.actionRefs, checkpoints: envelope.checkpointRefs } });
      }, { planCompletion, historyScope: scope }));
  }

  /** Call after an explicit canonical refresh and clearing the owning history. */
  async resetPlanHistory(scope = this.historyScope): Promise<void> {
    const generation = ++this.planHistoryResetGeneration;
    this.planHistoryFrozen = true;
    this.settleUnsentPlans("cancelled");
    this.bumpContextEpoch();
    const epoch = this.contextEpoch;
    const dir = this.expectedDataDir;
    await this.releasePlanHistory();
    if (generation !== this.planHistoryResetGeneration || this.disposed || epoch !== this.contextEpoch || dir !== this.expectedDataDir) return;
    this.historyScope = scope ? { ...scope } : undefined;
    this.planHistoryFrozen = false;
    this.historySequences.clear();
    this.deliveredPlanRequests.clear();
  }

  private releasePlanHistory(): Promise<void> {
    const scope = this.historyScope;
    if (!scope) return this.historyReleaseTail;
    const request = { expectedDataDir: this.expectedDataDir, historyOwnerId: scope.ownerId, hostEpoch: scope.hostEpoch, all: true as const };
    const release = this.historyReleaseTail.then(() => productivityTravelV2ReleasePlanHistory(request));
    this.historyReleaseTail = release.catch((error) => {
        this.lastError = `撤销记录清理失败：${String(error)}`;
      });
    return release;
  }

  queueSetCheckpointCompleted(itemId: string, payload: TravelSetCheckpointCompletedPayload): void {
    this.enqueueMutation(
      itemId,
      ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }),
      productivityTravelV2SetCheckpointCompleted,
    );
  }

  queueDeleteCheckpoint(itemId: string, payload: TravelDeleteCheckpointPayload): void {
    this.enqueueMutation(
      itemId,
      ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }),
      productivityTravelV2DeleteCheckpoint,
    );
  }

  queueDeleteStage(itemId: string, payload: TravelDeleteStagePayload): void {
    this.enqueueMutation(
      itemId,
      ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }),
      productivityTravelV2DeleteStage,
    );
  }

  getSnapshot(itemId: string): TripSnapshot | null {
    return this.snapshotByItemId.get(itemId) ?? null;
  }

  /** Week prefetch must not switch the selected trip or disturb its save state. */
  cacheWeekSnapshot(snapshot: TripSnapshot): void {
    if (this.disposed) return;
    const itemId = snapshot.item.id;
    const queue = this.perItemQueues.get(itemId);
    if (queue?.inflight || queue?.pending.length || this.draftFields.get(itemId)?.size) return;
    const current = this.snapshotByItemId.get(itemId);
    if (current && current.item.revision > snapshot.item.revision) return;
    this.snapshotByItemId.set(itemId, snapshot);
  }

  queueSetActual(itemId: string, payload: TravelSetActualPayload): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2SetActual);
  }

  queueFinish(itemId: string): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, {}, { requestId }), productivityTravelV2Finish);
  }

  queueReopen(itemId: string): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, {}, { requestId }), productivityTravelV2Reopen);
  }

  queueCancel(itemId: string, payload: TravelCancelPayload = {}): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2Cancel);
  }

  queueDeleteTrip(itemId: string): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, {}, { requestId }), productivityTravelV2DeleteTrip);
  }

  queueRestore(itemId: string, payload: TravelRestorePayload): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2Restore);
  }

  /** Manual flight query only; never auto-invoked by the controller. */
  async queryFlight(input: {
    itemId?: string;
    transportationId?: string;
    flightNumber: string;
    date: string;
  }): Promise<TravelQueryFlightResult> {
    const queryGeneration = this.bumpQueryGeneration();
    const snapshot = input.itemId ? this.snapshotForItem(input.itemId) : null;
    if (input.itemId && !snapshot) throw new Error("no trip snapshot for flight query");
    if (!input.itemId && input.transportationId) throw new Error("draft flight query cannot bind a persisted transportation");
    const context: TravelQueryFlightContext = {
      ...(snapshot && input.transportationId ? {
        itemId: snapshot.item.id,
        itemRevision: snapshot.item.revision,
        transportationId: input.transportationId,
      } : { draft: true }),
      expectedDataDir: this.expectedDataDir,
      queryGeneration,
    };
    const capturedEpoch = this.contextEpoch;
    const capturedDir = this.expectedDataDir;
    const result = await productivityTravelV2QueryFlight({
      requestId: newTravelMemberId(),
      expectedDataDir: capturedDir,
      itemRef: null,
      actionRefs: [],
      checkpointRefs: [],
      payload: { context, flightNumber: input.flightNumber, date: input.date },
    });
    if (capturedEpoch !== this.contextEpoch || capturedDir !== this.expectedDataDir) {
      throw new Error("query_context_expired");
    }
    if (queryGeneration !== this.queryGeneration) {
      throw new Error("query_context_expired");
    }
    return { ...result, queryGeneration, context };
  }

  queueAdoptFlight(itemId: string, payload: TravelAdoptFlightPayload): void {
    if (payload.queryGeneration !== this.queryGeneration) return;
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2AdoptFlight);
  }

  queueRestoreAdoptionFields(itemId: string, payload: TravelRestoreAdoptionFieldsPayload): void {
    this.enqueueMutation(itemId, ({ requestId, snapshot, expectedDataDir }) => buildTravelEnvelope(expectedDataDir, snapshot, payload, { requestId }), productivityTravelV2RestoreAdoptionFields);
  }

  async retryLostMutation(itemId: string, requestId: string): Promise<TravelMutationResult | null> {
    const dir = this.expectedDataDir;
    const epoch = this.contextEpoch;
    const receipt = await productivityTravelV2GetReceipt({ expectedDataDir: dir, requestId });
    if ("status" in receipt && receipt.status === "not_found") return null;
    const result = receipt as TravelMutationResult;
    const history = result.planHistory;
    const sequence = result.planHistoryToken ? this.historySequences.get(result.planHistoryToken) ?? 0 : 0;
    if (!history || (history.requestId === requestId && history.sequence >= sequence &&
      history.ownerId === this.historyScope?.ownerId && history.hostEpoch === this.historyScope?.hostEpoch)) {
      this.applyMutationResult(result, { itemId, requestId, epoch, dir });
    }
    return result;
  }

  abandonDrafts(itemId: string): void {
    this.draftFields.delete(itemId);
    const queue = this.perItemQueues.get(itemId);
    if (queue) queue.pending = queue.pending.filter((entry) => {
      if (!entry.sent) entry.planCompletion?.({ status: "cancelled", requestId: entry.requestId });
      return entry.sent;
    });
    if (this.countDrafts() === 0 && this.countQueued() === 0) this.saveState = "clean";
    this.emit();
  }

  private bumpContextEpoch(): void {
    this.contextEpoch += 1;
    this.planEditGeneration = 0;
    this.queryGeneration = 0;
  }

  private ensureQueue(itemId: string): ItemQueue {
    let queue = this.perItemQueues.get(itemId);
    if (!queue) {
      queue = { pending: [], inflight: null };
      this.perItemQueues.set(itemId, queue);
    }
    return queue;
  }

  private snapshotForItem(itemId: string): TripSnapshot | null {
    return this.snapshotByItemId.get(itemId) ?? null;
  }

  private cancelUnsentForAllItems(): void {
    for (const queue of this.perItemQueues.values()) {
      queue.pending = queue.pending.filter((entry) => {
        if (!entry.sent) entry.planCompletion?.({ status: "cancelled", requestId: entry.requestId });
        return entry.sent;
      });
    }
    this.draftFields.clear();
  }

  private settleUnsentPlans(status: "cancelled" | "uncertain"): void {
    for (const queue of this.perItemQueues.values()) queue.pending = queue.pending.filter((entry) => {
      if (!entry.sent && entry.planCompletion) {
        entry.planCompletion({ status, requestId: entry.requestId });
        return false;
      }
      return true;
    });
  }

  private countDrafts(): number {
    let count = 0;
    for (const drafts of this.draftFields.values()) count += drafts.size;
    return count;
  }

  private countQueued(): number {
    let count = 0;
    for (const queue of this.perItemQueues.values()) {
      count += queue.pending.length + (queue.inflight ? 1 : 0);
    }
    return count;
  }

  private pumpQueue(itemId: string): void {
    if (this.disposed) return;
    const queue = this.ensureQueue(itemId);
    if (queue.inflight) return;
    const next = queue.pending.find((entry) => !entry.sent);
    if (next?.planCompletion && this.planHistoryFrozen) {
      queue.pending = queue.pending.filter((entry) => entry !== next);
      next.planCompletion({ status: "uncertain", requestId: next.requestId });
      this.pumpQueue(itemId);
      return;
    }
    if (next?.planCompletion && (next.contextEpoch !== this.contextEpoch || next.expectedDataDir !== this.expectedDataDir ||
      (next.planGeneration != null && next.planGeneration !== this.planEditGeneration))) {
      queue.pending = queue.pending.filter((p) => p !== next);
      next.planCompletion({ status: "cancelled", requestId: next.requestId });
      this.pumpQueue(itemId);
      return;
    }
    if (!next) {
      if (this.countQueued() === 0 && this.countDrafts() === 0 && this.saveState !== "failed" && this.saveState !== "conflict") {
        this.saveState = "clean";
      }
      this.emit();
      return;
    }
    next.sent = true;
    queue.inflight = next;
    this.saveState = "saving";
    this.emit();
    let committed = false;
    void next
      .run()
      .catch(async (error) => {
        if (!next.planCompletion) throw error;
        // A lost response is reconciled with the same requestId, never retried
        // as a second write. A missing receipt still leaves the result unknown.
        try {
          const receipt = await productivityTravelV2GetReceipt({ expectedDataDir: next.expectedDataDir, requestId: next.requestId });
          if (!("status" in receipt)) return receipt;
        } catch { /* Preserve the original unknown result below. */ }
        throw error;
      })
      .then((result) => {
        if (queue.inflight?.requestId !== next.requestId) return;
        committed = true;
        const currentContext = !this.disposed && next.contextEpoch === this.contextEpoch && next.expectedDataDir === this.expectedDataDir;
        const history = result.planHistory;
        const scope = next.historyScope;
        if (!currentContext && scope && result.planHistoryToken) {
          void productivityTravelV2ReleasePlanHistory({ expectedDataDir: next.expectedDataDir,
            historyOwnerId: scope.ownerId, hostEpoch: scope.hostEpoch, all: false, tokenIds: [result.planHistoryToken] })
            .catch((error) => { this.lastError = `撤销记录清理失败：${String(error)}`; });
        }
        const knownSequence = result.planHistoryToken ? this.historySequences.get(result.planHistoryToken) ?? 0 : 0;
        const currentHistory = !this.deliveredPlanRequests.has(next.requestId) && (!history || (history.requestId === next.requestId && (!scope || (history.ownerId === scope.ownerId && history.hostEpoch === scope.hostEpoch)) && history.sequence >= knownSequence));
        if (next.planCompletion && currentContext && currentHistory) this.deliveredPlanRequests.add(next.requestId);
        if (currentContext && currentHistory && history && result.planHistoryToken) this.historySequences.set(result.planHistoryToken, history.sequence);
        next.planCompletion?.({ status: currentContext && currentHistory ? (result.changed ? "committed" : "noop") : "cancelled", requestId: next.requestId, result });
        queue.inflight = null;
        queue.pending = queue.pending.filter((entry) => entry.requestId !== next.requestId);
        if (next.fieldKey != null) {
          const drafts = this.draftFields.get(itemId);
          const sent = next.draftValue ?? null;
          if (drafts?.has(next.fieldKey)) {
            const current = drafts.get(next.fieldKey) ?? null;
            if (current === sent) {
              drafts.delete(next.fieldKey);
              if (drafts.size === 0) this.draftFields.delete(itemId);
            }
          }
        }
        if (currentHistory) this.applyMutationResult(result, {
          itemId,
          requestId: next.requestId,
          epoch: next.contextEpoch,
          dir: next.expectedDataDir,
        });
        this.pumpQueue(itemId);
      })
      .catch((error) => {
        // Commit receipts are delivered before callbacks/refresh. UI failures
        // cannot turn a saved operation into a failed or uncertain mutation.
        if (committed) {
          this.lastError = `计划已保存，刷新失败：${String(error)}`;
          this.pumpQueue(itemId);
          return;
        }
        if (queue.inflight?.requestId !== next.requestId) return;
        queue.inflight = null;
        queue.pending = queue.pending.filter((entry) => entry.requestId !== next.requestId);
        if (next.planCompletion) {
          if (next.contextEpoch !== this.contextEpoch || next.expectedDataDir !== this.expectedDataDir || this.disposed) {
            next.planCompletion({ status: "cancelled", requestId: next.requestId });
            this.pumpQueue(itemId);
            return;
          }
          const definite = isDefinitePlanFailure(error);
          this.planHistoryFrozen = !definite;
          if (!definite) this.settleUnsentPlans("uncertain");
          next.planCompletion({ status: definite ? "failed" : "uncertain", requestId: next.requestId, error });
          this.handleMutationError(error);
          if (!definite) this.lastError = "计划结果待核实；请核实提交结果并清空业务历史后继续";
          this.pumpQueue(itemId);
          return;
        }
        if (next.fieldKey != null) {
          const drafts = this.draftFields.get(itemId);
          const sent = next.draftValue ?? null;
          const hasDraft = drafts?.has(next.fieldKey) ?? false;
          const current = hasDraft ? (drafts?.get(next.fieldKey) ?? null) : undefined;
          if (!hasDraft || current === sent) {
            this.setTextDraft(itemId, next.fieldKey, sent);
          }
        }
        const errorKind = classifyTravelError(error);
        this.failedCommits.push({
          itemId,
          requestId: next.requestId,
          fieldKey: next.fieldKey,
          draftValue: next.draftValue ?? null,
          errorKind,
          message: error instanceof Error ? error.message : String(error),
          mutation: { ...next, sent: false },
        });
        this.handleMutationError(error, errorKind);
        this.pumpQueue(itemId);
      });
  }

  private applyMutationResult(
    result: TravelMutationResult | TravelAdoptFlightResult,
    meta: { itemId: string; requestId: string; epoch: number; dir: string },
  ): void {
    if (this.disposed) return;
    if (meta.epoch !== this.contextEpoch || meta.dir !== this.expectedDataDir) return;
    const known = this.snapshotByItemId.get(meta.itemId);
    if (known && known.item.revision > result.snapshot.item.revision) return;
    this.snapshotByItemId.set(meta.itemId, result.snapshot);
    this.currentSnapshot = result.snapshot;
    this.lastError = null;
    this.lastErrorKind = null;
    if (this.countQueued() === 0 && this.countDrafts() === 0 && this.failedCommits.length === 0) this.saveState = "clean";
    else if (this.saveState !== "failed" && this.saveState !== "conflict") this.saveState = "dirty";
    this.onSnapshotCommitted?.(result.snapshot, meta.itemId);
    this.emit();
  }

  private async runMutation<T extends TravelMutationResult | TravelAdoptFlightResult>(
    _itemId: string,
    _requestId: string,
    execute: () => Promise<T>,
  ): Promise<T> {
    return execute();
  }

  private handleMutationError(error: unknown, errorKind?: TravelErrorKind): void {
    const kind = errorKind ?? classifyTravelError(error);
    if (kind === "conflict") {
      this.saveState = "conflict";
    } else {
      this.saveState = "failed";
    }
    this.lastErrorKind = kind;
    this.lastError = error instanceof Error ? error.message : String(error);
    this.emit();
  }

  private emit(): void {
    this.onStateChange?.(this.getState());
  }
}

function extractTravelErrorCode(error: unknown): string | null {
  if (typeof error === "string") {
    try { return extractTravelErrorCode(JSON.parse(error)); } catch { return null; }
  }
  if (!error || typeof error !== "object") return null;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code) return maybe.code;
  if (typeof maybe.message === "string") {
    const match = maybe.message.match(/(revision_conflict|membership_conflict|travel_command_required|query_context_expired)/);
    return match?.[1] ?? null;
  }
  return null;
}

function isDefinitePlanFailure(error: unknown): boolean {
  const code = extractTravelErrorCode(error);
  return code != null && ["revision_conflict", "REVISION_CONFLICT", "membership_conflict", "invalid_plan", "INVALID_PATCH", "INVALID_TIME_VALUE",
    "action_overlap", "checkpoint_inside_action", "point_merge_required", "protected_structure", "cross_item_reference", "unknown_format_readonly",
    "UNKNOWN_FIELD_WRITE_BLOCKED", "restore_conflict", "request_id_reused", "ROOT_NOT_FOUND", "ROOT_DELETED", "ARCHIVED_LIST_READONLY", "ARCHIVE_BUSY"].includes(code);
}

function classifyTravelError(error: unknown): TravelErrorKind {
  const code = extractTravelErrorCode(error);
  if (code === "revision_conflict" || code === "membership_conflict") return "conflict";
  return "generic";
}

// Re-export command helpers used by hosts wiring typed intents.
export {
  productivityTravelV2Split,
  productivityTravelV2DeleteStage,
  productivityTravelV2DeleteCheckpoint,
  productivityTravelV2ClearPoint,
  productivityTravelV2SetCheckpointCompleted,
  productivityTravelV2SetJoinActual,
};

export type ArrangementHistoryScope = {
  ownerId: string;
  epoch: number;
  expectedDataDir: string;
};

export type ArrangementReplayResult =
  | { status: "committed" | "noop" }
  | { status: "cancelled" }
  | { status: "failed"; message: string }
  | { status: "uncertain"; message: string };

export type ArrangementHistoryOperation = {
  id: string;
  label: string;
  /** Adapters compare the current canonical effect before submitting a guarded new transaction. */
  replay: (direction: "undo" | "redo", scope: ArrangementHistoryScope) => Promise<ArrangementReplayResult>;
  release?: () => void;
};

export type ArrangementForwardResult<T> = {
  value: T;
  status: "committed" | "noop" | "cancelled" | "uncertain";
  operation?: ArrangementHistoryOperation;
  message?: string;
};

/** Only the adapter can classify an absent commit receipt as uncertain. */
export class ArrangementCommitUncertain extends Error {}

/** Memory belongs to one destination instance; navigation history is deliberately independent. */
export class ArrangementHistory {
  readonly scope: Readonly<ArrangementHistoryScope>;
  private entries: ArrangementHistoryOperation[] = [];
  private cursor = 0;
  private busy = false;
  private generation = 0;
  private frozenReason: string | null = null;
  private disposed = false;

  constructor(
    scope: ArrangementHistoryScope,
    private readonly isCurrent: () => boolean,
    private readonly report: (message: string) => void,
  ) { this.scope = Object.freeze({ ...scope }); }

  get isBusy(): boolean { return this.busy; }
  get isFrozen(): boolean { return this.frozenReason !== null; }
  get canUndo(): boolean { return this.cursor > 0 && !this.busy && !this.isFrozen && !this.disposed; }
  get canRedo(): boolean { return this.cursor < this.entries.length && !this.busy && !this.isFrozen && !this.disposed; }

  async forward<T>(write: () => Promise<ArrangementForwardResult<T>>): Promise<T> {
    this.assertReady();
    this.busy = true;
    const generation = this.generation;
    try {
      const result = await write();
      if (!this.live(generation)) { if (result.operation) this.releaseOperations([result.operation]); return result.value; }
      if (result.status === "uncertain") this.freeze(result.message ?? "结果待核实，请刷新核对后清空撤销历史。");
      else if (result.status === "committed") {
        if (result.operation && this.entries.some((entry) => entry.id === result.operation!.id)) return result.value;
        this.releaseOperations(this.entries.splice(this.cursor));
        if (result.operation) this.entries.push(result.operation);
        if (this.entries.length > 100) this.releaseOperations(this.entries.splice(0, this.entries.length - 100));
        this.cursor = this.entries.length;
      }
      return result.value;
    } catch (error) {
      if (error instanceof ArrangementCommitUncertain && this.live(generation)) this.freeze(error.message);
      throw error;
    } finally { this.busy = false; }
  }

  async replay(direction: "undo" | "redo"): Promise<void> {
    if (this.busy || this.disposed || !this.isCurrent()) return;
    if (this.frozenReason) { this.report(this.frozenReason); return; }
    const index = direction === "undo" ? this.cursor - 1 : this.cursor;
    const entry = this.entries[index];
    if (!entry) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const result = await entry.replay(direction, this.scope);
      if (!this.live(generation)) return;
      if (result.status === "committed" || result.status === "noop") this.cursor += direction === "undo" ? -1 : 1;
      else if (result.status === "uncertain") this.freeze(result.message);
      else if (result.status === "failed") this.report(result.message);
    } catch (error) {
      if (this.live(generation)) {
        if (error instanceof ArrangementCommitUncertain) this.freeze(error.message);
        else this.report(error instanceof Error ? error.message : String(error));
      }
    } finally { this.busy = false; }
  }

  /** Call after explicit canonical reconciliation, never as an automatic failed-write retry. */
  clear(): void {
    if (this.busy) throw new Error("安排正在保存，暂不能清空撤销历史。");
    this.releaseEntries();
  }

  dispose(): void { this.disposed = true; this.releaseEntries(); }

  private releaseEntries(): void {
    this.generation++;
    this.releaseOperations(this.entries.splice(0));
    this.cursor = 0;
    this.frozenReason = null;
  }

  private live(generation: number): boolean { return !this.disposed && generation === this.generation && this.isCurrent(); }
  private assertReady(): void {
    if (this.disposed || !this.isCurrent()) throw new Error("安排实例或数据目录已变化，操作已取消。");
    if (this.busy) throw new Error("安排正在保存，请稍后再试。");
    if (this.frozenReason) throw new Error(this.frozenReason);
  }
  private freeze(message: string): void { this.frozenReason = message; this.report(message); }
  private releaseOperations(entries: ArrangementHistoryOperation[]): void {
    for (const entry of entries) {
      try { entry.release?.(); }
      catch (error) { this.report(`撤销记录已释放，但关联资源清理失败：${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}

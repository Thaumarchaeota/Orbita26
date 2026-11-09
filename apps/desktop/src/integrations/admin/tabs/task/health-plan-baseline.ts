import type { HealthPlanSnapshot, RevisionRef } from "../../../productivity/types";

export type HealthPlanMoveBaseline = { expectedDataDir?: string; action: RevisionRef; targetOwningRoot: RevisionRef | null };

/** A refresh during a drag cannot grant permission to overwrite the newer Item/Action pair. */
export function assertHealthPlanMoveBaseline(plan: HealthPlanSnapshot, baseline: HealthPlanMoveBaseline, expectedDataDir: string, currentDataDir: string): void {
  if (baseline.expectedDataDir !== expectedDataDir || currentDataDir !== expectedDataDir ||
    baseline.action.id !== plan.action.id || baseline.action.expectedRevision !== plan.action.revision ||
    !baseline.targetOwningRoot || baseline.targetOwningRoot.id !== plan.item.id || baseline.targetOwningRoot.expectedRevision !== plan.item.revision) {
    throw new Error("健康计划或数据目录在拖动期间已变化，请刷新后重新拖动。");
  }
}

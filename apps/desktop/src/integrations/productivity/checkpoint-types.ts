import type { ActionAppearance, RevisionRef } from "./types";

export type CheckpointTargetKind = "project" | "task" | "item";

/** Canonical snapshot for an independent, single-point productivity checkpoint. */
export type CheckpointSnapshot = {
  schemaVersion: number;
  id: string;
  nameLinkMode: "initial-linked" | "manually-linked" | "unlinked";
  revision: number;
  title: string;
  description: string | null;
  appearance: ActionAppearance | null;
  plannedAtUtc: string | null;
  actualAtUtc: string | null;
  completed: boolean;
  sessionId: string | null;
  targetKind: CheckpointTargetKind | null;
  targetId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc: string | null;
};

export type CreateCheckpointRequest = {
  expectedDataDir: string;
  title: string;
  description?: string | null;
  appearance?: ActionAppearance | null;
  plannedAtUtc?: string | null;
  targetKind?: CheckpointTargetKind | null;
  targetId?: string | null;
  owningRoot?: RevisionRef | null;
  nameLinkMode?: "initial-linked" | "manually-linked" | "unlinked";
  session?: RevisionRef | null;
};

export type GetCheckpointRequest = {
  id: string;
  includeDeleted: boolean;
};

export type ListCheckpointsRequest = {
  includeDeleted: boolean;
};

export type UpdateCheckpointRequest = {
  expectedDataDir: string;
  checkpoint: RevisionRef;
  title?: string;
  description?: string | null;
  appearance?: ActionAppearance | null;
  plannedAtUtc?: string | null;
  nameLinkMode?: "initial-linked" | "manually-linked" | "unlinked";
};

export type CompleteCheckpointRequest = {
  expectedDataDir: string;
  checkpoint: RevisionRef;
  actualAtUtc?: string | null;
};

export type CorrectCheckpointActualRequest = {
  expectedDataDir: string;
  checkpoint: RevisionRef;
  actualAtUtc: string | null;
};

export type CheckpointRequest = {
  detachSession?: boolean;
  expectedDataDir: string;
  checkpoint: RevisionRef;
  session?: RevisionRef | null;
};

export type SetCheckpointTargetRequest = {
  expectedDataDir: string;
  checkpoint: RevisionRef;
  targetKind: CheckpointTargetKind;
  targetId: string;
  owningRoot: RevisionRef;
};

export type AssignCheckpointSessionRequest = {
  expectedDataDir: string;
  checkpoint: RevisionRef;
  session: RevisionRef;
};

export type CheckpointResponse = { checkpoint: CheckpointSnapshot };
export type CheckpointsListResponse = { checkpoints: CheckpointSnapshot[] };

export type CommitItemWithCheckpointRequest = {
  expectedDataDir: string; itemTitle: string; checkpointTitle: string; plannedAtUtc?: string | null; session?: RevisionRef | null;
};
export type CommitCheckpointArrangementRequest = {
  expectedDataDir: string; checkpoint: RevisionRef; plannedAtUtc: string | null; currentSession?: RevisionRef | null; nextSession?: RevisionRef | null; expectedCurrentCheckpoints: RevisionRef[]; expectedNextCheckpoints: RevisionRef[];
};
export type ItemWithCheckpointResponse = { item: import("./types").ItemSnapshot; checkpoint: CheckpointSnapshot };

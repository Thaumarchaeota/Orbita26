import type { TaskSnapshot } from "../../../productivity/types";

/** The flat projection needed for child counts, directly derived from the shared TaskSnapshot DTO. */
export type ProgressTask = Pick<TaskSnapshot, "id" | "parentTaskId" | "status" | "deletedAtUtc">;

export type DirectChildProgress =
  | { kind: "no-children"; completed: 0; total: 0 }
  | { kind: "all-cancelled"; completed: 0; total: 0; cancelled: number }
  | { kind: "count"; completed: number; total: number; cancelled: number };

export interface ProjectTaskProgress {
  /** Original DTO is retained intact, including fields unknown to this selector. */
  task: TaskSnapshot;
  directChildren: DirectChildProgress;
}

/** Count only living immediate children; cancelled children do not enter the denominator. */
export function selectDirectChildProgress(parentTaskId: string, tasks: readonly ProgressTask[]): DirectChildProgress {
  const children = tasks.filter((task) => (task.parentTaskId ?? null) === parentTaskId && task.deletedAtUtc == null);
  if (children.length === 0) return { kind: "no-children", completed: 0, total: 0 };
  return summarize(children);
}

/** ProjectSnapshot.tasks is flat; derive each row's direct-child progress without truncating depth. */
export function selectProjectTaskProgress(tasks: readonly TaskSnapshot[]): readonly ProjectTaskProgress[] {
  return tasks.map((task) => ({
    task,
    directChildren: selectDirectChildProgress(task.id, tasks),
  }));
}

function summarize(children: readonly ProgressTask[]): DirectChildProgress {
  const counted = children.filter((task) => task.status !== "取消");
  const cancelled = children.length - counted.length;
  if (counted.length === 0) return { kind: "all-cancelled", completed: 0, total: 0, cancelled };
  return {
    kind: "count",
    completed: counted.filter((task) => task.status === "完成").length,
    total: counted.length,
    cancelled,
  };
}

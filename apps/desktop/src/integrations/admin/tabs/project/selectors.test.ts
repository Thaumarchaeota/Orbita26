import { describe, expect, it } from "vitest";
import type { TaskSnapshot } from "../../../productivity/types";
import { selectDirectChildProgress, selectProjectTaskProgress } from "./selectors";

function task(id: string, parentTaskId: string | null | undefined, status: string, deletedAtUtc: string | null = null): TaskSnapshot {
  return {
    id, projectId: "project-1", parentTaskId, title: id, status,
    createdAtUtc: "2026-01-01T00:00:00Z", updatedAtUtc: "2026-01-01T00:00:00Z", deletedAtUtc,
  };
}

describe("Project task progress selectors", () => {
  it("counts only living immediate TaskSnapshot rows and excludes cancelled from the denominator", () => {
    const tasks = [
      task("parent", null, "未做"),
      task("done", "parent", "完成"),
      task("paused", "parent", "搁置"),
      task("cancelled", "parent", "取消"),
      task("soft-deleted", "parent", "未做", "2026-01-02T00:00:00Z"),
      task("grandchild", "done", "完成"),
    ];
    expect(selectDirectChildProgress("parent", tasks)).toEqual({ kind: "count", completed: 1, total: 2, cancelled: 1 });
  });

  it("distinguishes no direct children from all living children cancelled", () => {
    expect(selectDirectChildProgress("empty", [])).toEqual({ kind: "no-children", completed: 0, total: 0 });
    expect(selectDirectChildProgress("parent", [
      task("parent", null, "未做"), task("c1", "parent", "取消"), task("c2", "parent", "取消"),
      task("deleted", "parent", "未做", "2026-01-02T00:00:00Z"),
    ])).toEqual({ kind: "all-cancelled", completed: 0, total: 0, cancelled: 2 });
  });

  it("retains all flat rows through depth five and leaves input DTOs untouched", () => {
    const tasks = Object.freeze([
      task("d1", null, "未做"), task("d2", "d1", "未做"), task("d3", "d2", "未做"),
      task("d4", "d3", "未做"), task("d5", "d4", "完成"),
    ]);
    const before = tasks.map((entry) => ({ ...entry }));
    const result = selectProjectTaskProgress(tasks);
    expect(result.map((entry) => entry.task.id)).toEqual(["d1", "d2", "d3", "d4", "d5"]);
    expect(result[3]?.directChildren).toEqual({ kind: "count", completed: 1, total: 1, cancelled: 0 });
    expect(tasks).toEqual(before);
    expect(result[0]?.task).toBe(tasks[0]);
  });
});

import { describe, expect, it } from "vitest";
import { itemKey, sanitizeWorkspaceNav } from "./workspace-nav-persist";

describe("sanitizeWorkspaceNav", () => {
  it("drops dangling project/list ids and invalid group refs", () => {
    const state = sanitizeWorkspaceNav(
      {
        groups: [{ id: "g1", title: "A", collapsed: false }],
        groupOrder: ["g1", "gone"],
        membership: {
          [itemKey("project", "p1")]: "g1",
          [itemKey("project", "dead")]: "g1",
          [itemKey("list", "l1")]: "gone",
        },
        pinnedListIds: ["l1", "dead"],
        ungroupedOrder: [itemKey("project", "p1"), itemKey("list", "dead")],
      },
      new Set(["p1"]),
      new Set(["l1"]),
    );
    expect(state.groupOrder).toEqual(["g1"]);
    expect(state.pinnedListIds).toEqual(["l1"]);
    expect(state.membership).toEqual({ [itemKey("project", "p1")]: "g1", [itemKey("list", "l1")]: null });
    expect(state.ungroupedOrder).toEqual([itemKey("project", "p1")]);
  });
});

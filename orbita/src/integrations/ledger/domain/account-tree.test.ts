import { describe, expect, it } from "vitest";
import {
  accountMatchesPrefix,
  buildAccountForest,
  collectTreeCheckState,
  expandAccountSelection,
  type AccountTreeNode,
} from "./account-tree";
import { setAccounts } from "../state/accounts";

const sampleTree = (): AccountTreeNode => ({
  id: "Assets",
  name: "Assets",
  label: "Assets",
  isLeaf: false,
  children: [
    {
      id: "Assets:Cash",
      name: "Assets:Cash",
      label: "Cash",
      isLeaf: true,
      children: [],
    },
    {
      id: "Assets:Bank",
      name: "Assets:Bank",
      label: "Bank",
      isLeaf: true,
      children: [],
    },
  ],
});

describe("account-tree", () => {
  it("matches account prefixes for subtree expansion", () => {
    expect(accountMatchesPrefix("Assets:Cash", "Assets")).toBe(true);
    expect(accountMatchesPrefix("Assets:Cash", "Assets:Cash")).toBe(true);
    expect(accountMatchesPrefix("Liabilities:Card", "Assets")).toBe(false);
  });

  it("derives checked / indeterminate / unchecked cascade state from leaf names only", () => {
    const tree = sampleTree();

    expect(collectTreeCheckState(tree, new Set())).toBe("unchecked");
    expect(collectTreeCheckState(tree, new Set(["Assets"]))).toBe("indeterminate");
    expect(collectTreeCheckState(tree, new Set(["Assets:Cash"]))).toBe("indeterminate");
    expect(collectTreeCheckState(tree, new Set(["Assets:Cash", "Assets:Bank"]))).toBe("checked");
    expect(collectTreeCheckState(tree, new Set(["Assets", "Assets:Cash", "Assets:Bank"]))).toBe("checked");
  });

  it("parent shows checked when all leaf descendants are selected without parent path", () => {
    const tree = sampleTree();
    expect(collectTreeCheckState(tree, new Set(["Assets:Cash", "Assets:Bank"]))).toBe("checked");
    expect(collectTreeCheckState(tree, new Set(["Assets:Cash"]))).toBe("indeterminate");
  });

  it("builds forest and expands selected prefixes", () => {
    setAccounts({
      assets: [
        {
          name: "Assets:Cash",
          label: "现金",
          label_path: ["Assets", "Cash"],
          brief: "",
          open_date: "",
          extra: "",
          id: "1",
          source_file: "a.bean",
          source_line: 1,
        },
        {
          name: "Assets:Bank",
          label: "银行",
          label_path: ["Assets", "Bank"],
          brief: "",
          open_date: "",
          extra: "",
          id: "2",
          source_file: "a.bean",
          source_line: 2,
        },
      ],
      liabilities: [],
      expenses: [],
      income: [],
    });

    const forest = buildAccountForest(["assets"]);
    expect(forest.some((n) => n.id === "Assets")).toBe(true);

    const expanded = expandAccountSelection(new Set(["Assets"]));
    expect(expanded.has("Assets:Cash")).toBe(true);
    expect(expanded.has("Assets:Bank")).toBe(true);
  });
});

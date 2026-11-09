import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemSnapshot } from "../../productivity/types";

const {
  productivityCommitItemWithActions,
  productivityCreateList,
  productivityListActions,
  productivityListItems,
  productivityListLists,
  productivityMoveItemToListAndPlace,
  productivityReorderItems,
  productivityUpdateItem,
} = vi.hoisted(() => ({
  productivityCommitItemWithActions: vi.fn(),
  productivityCreateList: vi.fn(),
  productivityListActions: vi.fn(),
  productivityListItems: vi.fn(),
  productivityListLists: vi.fn(),
  productivityMoveItemToListAndPlace: vi.fn(),
  productivityReorderItems: vi.fn(),
  productivityUpdateItem: vi.fn(),
}));

vi.mock("../../productivity/client", () => ({
  productivityCommitItemWithActions,
  productivityCreateList,
  productivityListActions,
  productivityListItems,
  productivityListLists,
  productivityMoveItemToListAndPlace,
  productivityReorderItems,
  productivityUpdateItem,
}));

import { workDestination } from "./work";

const handles: Array<{ dispose: (reason: "host-dispose") => void }> = [];

const originalItem: ItemSnapshot = {
  id: "item-1",
  revision: 4,
  title: "Original title",
  status: "进行中",
  priority: "none",
  createdAtUtc: "2026-01-10T01:30:00Z",
  updatedAtUtc: "2026-01-10T01:30:00Z",
};

async function mountWorkPage() {
  const root = document.createElement("div");
  document.body.append(root);
  const handle = workDestination.mount(root, { generation: 1, dataDirKey: "test" });
  handles.push(handle);
  productivityListLists.mockResolvedValue({ lists: [] });
  productivityListItems.mockResolvedValue({
    items: [originalItem],
    itemOrder: {
      id: "item-order",
      revision: 1,
      orderedItemIds: [originalItem.id],
      updatedAtUtc: "2026-01-10T01:30:00Z",
    },
  });
  productivityListActions.mockResolvedValue({ actions: [] });
  await handle.activate();
  return root;
}

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose("host-dispose");
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("Work inline item title editing", () => {
  it("does not insert a new item when title save fails on Enter and blur", async () => {
    productivityUpdateItem.mockRejectedValue(new Error("write denied"));
    productivityCommitItemWithActions.mockResolvedValue({ item: { ...originalItem, id: "new-item" }, actions: [] });
    productivityReorderItems.mockResolvedValue({
      itemOrder: {
        id: "item-order",
        revision: 2,
        orderedItemIds: [originalItem.id, "new-item"],
        updatedAtUtc: "2026-01-10T01:31:00Z",
      },
      items: [originalItem, { ...originalItem, id: "new-item", title: "新任务" }],
    });

    const root = await mountWorkPage();
    const input = root.querySelector<HTMLInputElement>(".work-item-title")!;
    input.value = "Unsaved title";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(productivityUpdateItem).toHaveBeenCalledTimes(1);
    expect(productivityCommitItemWithActions).not.toHaveBeenCalled();
    expect(root.querySelector('[data-region="error"]')?.textContent).toContain("write denied");
  });
});

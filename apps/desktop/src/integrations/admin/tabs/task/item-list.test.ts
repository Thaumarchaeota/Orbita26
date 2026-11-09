import { afterEach, describe, expect, it, vi } from "vitest";
import type { ItemOrderSnapshot, ItemSnapshot } from "../../../productivity/types";

const {
  productivityCreateItem,
  productivityCreateItemAfter,
  productivityDeleteItem,
  productivitySetItemStatus,
  productivityUpdateItem,
} = vi.hoisted(() => ({
  productivityCreateItem: vi.fn(),
  productivityCreateItemAfter: vi.fn(),
  productivityDeleteItem: vi.fn(),
  productivitySetItemStatus: vi.fn(),
  productivityUpdateItem: vi.fn(),
}));

vi.mock("../../../productivity/client", () => ({
  productivityCreateItem,
  productivityCreateItemAfter,
  productivityDeleteItem,
  productivityMoveItemToListAndPlace: vi.fn(),
  productivityReorderItems: vi.fn(),
  productivitySetItemStatus,
  productivityUpdateItem,
}));

vi.mock("./item-detail", () => ({
  openItemDetailDialog: vi.fn(),
}));

vi.mock("./task-rail", () => ({
  unarchiveList: vi.fn(),
}));

import { mountItemList } from "./item-list";
import type { TaskDataSlice, TaskScope } from "./task-selectors";

const listId = "list-a";
const itemOrder: ItemOrderSnapshot = {
  id: "item-order",
  revision: 1,
  orderedItemIds: ["item-1", "item-2"],
  updatedAtUtc: "2026-01-10T01:30:00Z",
};

function makeItem(id: string, title: string, revision = 1): ItemSnapshot {
  return {
    id,
    revision,
    listId,
    title,
    status: "进行中",
    priority: "none",
    createdAtUtc: "2026-01-10T01:30:00Z",
    updatedAtUtc: "2026-01-10T01:30:00Z",
  };
}

const item1 = makeItem("item-1", "任务 1");
const item2 = makeItem("item-2", "任务 2");

function mountList(scope: TaskScope = { kind: "list", listId }) {
  const host = document.createElement("div");
  document.body.append(host);
  let store: TaskDataSlice = {
    lists: [{ id: listId, revision: 1, title: "清单 A", status: "进行中", createdAtUtc: "", updatedAtUtc: "" }],
    items: [item1, item2],
    itemOrder,
  };
  const binding = mountItemList({
    host,
    getScope: () => scope,
    getStore: () => store,
    getVisibility: () => ({ showCompleted: true, showCancelled: true }),
    getLoading: () => false,
    getLoadError: () => null,
    onStoreChange: (next) => {
      store = next;
    },
    onReload: async () => {},
    onError: () => {},
    onSelectArchivedList: () => {},
    onSelectList: () => {},
  });
  binding.render();
  return { host, binding, getStore: () => store };
}

afterEach(() => {
  document.body.replaceChildren();
  productivitySetItemStatus.mockReset();
  vi.clearAllMocks();
});

describe("item-list CreateItemAfter", () => {
  it("plays Item completion feedback immediately and does not replay after save", async () => {
    let resolveWrite!: (value: { item: ItemSnapshot }) => void;
    productivitySetItemStatus.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));
    const getStyle = vi.spyOn(window, "getComputedStyle").mockReturnValue({ animationName: "orbita-checkbox-burst" } as CSSStyleDeclaration);
    const { host } = mountList();
    const checkbox = host.querySelector<HTMLButtonElement>('[data-item-id="item-1"] .task-item-check')!;

    checkbox.click();
    expect(host.querySelector(".task-item-check.is-checking")).not.toBeNull();
    expect(getStyle).toHaveBeenCalledTimes(1);
    resolveWrite({ item: { ...item1, status: "完成", revision: 2 } });
    await vi.waitFor(() => expect(host.querySelector(".task-item-row.is-pending")).toBeNull());
    expect(getStyle).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(host.querySelector(".task-item-check.is-checking")).not.toBeNull());
  });

  it("rolls back the optimistic Item completion feedback when the status write fails", async () => {
    productivitySetItemStatus.mockRejectedValue(new Error("write failed"));
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ animationName: "orbita-checkbox-burst" } as CSSStyleDeclaration);
    const { host } = mountList();

    host.querySelector<HTMLButtonElement>('[data-item-id="item-1"] .task-item-check')!.click();
    expect(host.querySelector(".task-item-check.is-checking")).not.toBeNull();
    await vi.waitFor(() => expect(host.querySelector(".task-item-row.is-pending")).toBeNull());
    expect(host.querySelector(".task-item-check.is-checking")).toBeNull();
  });

  it("uses CreateItemAfter after Enter on inline rename, not CreateItem", async () => {
    productivityUpdateItem.mockResolvedValue({ item: { ...item1, title: "任务 1 改", revision: 2 } });
    productivityCreateItemAfter.mockResolvedValue({
      item: makeItem("item-3", "任务 3"),
      itemOrder: {
        ...itemOrder,
        revision: 2,
        orderedItemIds: ["item-1", "item-3", "item-2"],
      },
      items: [item1, makeItem("item-3", "任务 3"), item2],
    });

    const { host } = mountList();
    host.querySelector<HTMLElement>('[data-edit-id="item-1"]')!.click();
    const titleInput = host.querySelector<HTMLInputElement>('.task-item-title-input[data-item-id="item-1"]')!;
    titleInput.value = "任务 1 改";
    titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => host.querySelector(".task-item-draft-input"));
    expect(productivityCreateItem).not.toHaveBeenCalled();

    const draft = host.querySelector<HTMLInputElement>(".task-item-draft-input")!;
    draft.value = "任务 3";
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => productivityCreateItemAfter.mock.calls.length > 0);

    expect(productivityCreateItem).not.toHaveBeenCalled();
    expect(productivityCreateItemAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        insertAfterItemId: "item-1",
        listId,
        title: "任务 3",
      }),
    );
  });

  it("inserts new item after anchor in visible order 1,3,2", async () => {
    productivityUpdateItem.mockResolvedValue({ item: item1 });
    const item3 = makeItem("item-3", "任务 3");
    productivityCreateItemAfter.mockResolvedValue({
      item: item3,
      itemOrder: { ...itemOrder, revision: 2, orderedItemIds: ["item-1", "item-3", "item-2"] },
      items: [item1, item3, item2],
    });

    const { host, getStore } = mountList();
    host.querySelector<HTMLElement>('[data-edit-id="item-1"]')!.click();
    const titleInput = host.querySelector<HTMLInputElement>('.task-item-title-input[data-item-id="item-1"]')!;
    titleInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => host.querySelector(".task-item-draft-input"));

    const draft = host.querySelector<HTMLInputElement>(".task-item-draft-input")!;
    draft.value = "任务 3";
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => getStore().itemOrder?.orderedItemIds.includes("item-3"));

    expect(getStore().itemOrder?.orderedItemIds).toEqual(["item-1", "item-3", "item-2"]);
    const titles = [...host.querySelectorAll(".task-item-title")].map((el) => el.textContent);
    expect(titles).toEqual(["任务 1", "任务 3", "任务 2"]);
  });

  it("create entry at list end uses CreateItemAfter with last visible item", async () => {
    productivityCreateItemAfter.mockResolvedValue({
      item: makeItem("item-3", "末尾任务"),
      itemOrder: { ...itemOrder, revision: 2, orderedItemIds: ["item-1", "item-2", "item-3"] },
      items: [item1, item2, makeItem("item-3", "末尾任务")],
    });

    const { host } = mountList();
    host.querySelector<HTMLButtonElement>('[data-action="create"]')!.click();
    expect(host.querySelector(".task-create-entry")).toBeNull();
    expect(host.querySelector(".task-item-draft-input")).not.toBeNull();

    const draft = host.querySelector<HTMLInputElement>(".task-item-draft-input")!;
    draft.value = "末尾任务";
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => productivityCreateItemAfter.mock.calls.length > 0);

    expect(productivityCreateItem).not.toHaveBeenCalled();
    expect(productivityCreateItemAfter).toHaveBeenCalledWith(
      expect.objectContaining({ insertAfterItemId: "item-2", title: "末尾任务" }),
    );
  });
});

describe("item-list create entry in place", () => {
  it("converts create button to input in same row slot", () => {
    const { host } = mountList();
    const createBtn = host.querySelector<HTMLButtonElement>('[data-action="create"]')!;
    const list = host.querySelector(".task-item-list")!;
    const childCountBefore = list.children.length;
    createBtn.click();
    expect(host.querySelector('[data-action="create"]')).toBeNull();
    expect(host.querySelector(".task-item-draft-input")).not.toBeNull();
    expect(list.children.length).toBe(childCountBefore);
  });

  it("restores create entry on empty Escape", () => {
    const { host } = mountList();
    host.querySelector<HTMLButtonElement>('[data-action="create"]')!.click();
    const draft = host.querySelector<HTMLInputElement>(".task-item-draft-input")!;
    draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(host.querySelector('[data-action="create"]')).not.toBeNull();
    expect(host.querySelector(".task-item-draft-input")).toBeNull();
  });
});

describe("item-list checkbox status", () => {
  it("checks to complete and unchecks to in-progress", async () => {
    productivitySetItemStatus.mockResolvedValueOnce({ item: { ...item1, status: "完成", revision: 2 } });
    productivitySetItemStatus.mockResolvedValueOnce({ item: { ...item1, status: "进行中", revision: 3 } });

    const { host } = mountList();
    const check = host.querySelector<HTMLButtonElement>('.task-item-row[data-item-id="item-1"] .task-item-check')!;
    check.click();
    await vi.waitFor(() => productivitySetItemStatus.mock.calls.length === 1);
    expect(productivitySetItemStatus).toHaveBeenCalledWith({
      item: { id: "item-1", expectedRevision: 1 },
      status: "完成",
    });

    check.click();
    await vi.waitFor(() => productivitySetItemStatus.mock.calls.length === 2);
    expect(productivitySetItemStatus).toHaveBeenLastCalledWith({
      item: expect.objectContaining({ id: "item-1" }),
      status: "进行中",
    });
  });
});

describe("item-list loading placeholder", () => {
  it("replaces rows only while the host reports a blocking load", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let loading = false;
    const store: TaskDataSlice = {
      lists: [{ id: listId, revision: 1, title: "清单 A", status: "进行中", createdAtUtc: "", updatedAtUtc: "" }],
      items: [item1, item2],
      itemOrder,
    };
    const binding = mountItemList({
      host,
      getScope: () => ({ kind: "list", listId }),
      getStore: () => store,
      getVisibility: () => ({ showCompleted: true, showCancelled: true }),
      getLoading: () => loading,
      getLoadError: () => null,
      onStoreChange: () => {},
      onReload: async () => {},
      onError: () => {},
      onSelectArchivedList: () => {},
      onSelectList: () => {},
    });
    binding.render();
    expect(host.querySelectorAll(".task-item-row")).toHaveLength(2);

    loading = true;
    binding.render();
    expect(host.textContent).toContain("加载中…");
    expect(host.querySelector(".task-item-row")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemSnapshot } from "../../../productivity/types";

const productivityListActions = vi.hoisted(() => vi.fn());
const productivityCommitItemWithActions = vi.hoisted(() => vi.fn());

vi.mock("../../../productivity/client", () => ({
  productivityListActions,
  productivityCommitItemWithActions,
}));

vi.mock("../../../shell/dialog", () => ({
  getConfirmDialog: () => async () => true,
}));

vi.mock("../../../../ui/modal-root", () => ({
  mountModalBackdrop: (backdrop: HTMLElement) => document.body.appendChild(backdrop),
}));

vi.mock("../../../../ui/motion", () => ({
  bindDialog: (backdrop: HTMLElement) => ({
    open: async () => backdrop.classList.add("is-open"),
    close: async () => {
      backdrop.classList.remove("is-open");
      backdrop.remove();
    },
    isOpen: () => backdrop.classList.contains("is-open"),
  }),
}));

function makeItem(): ItemSnapshot {
  return {
    id: "item-1",
    revision: 3,
    title: "Task A",
    description: null,
    status: "open",
    priority: "none",
    createdAtUtc: "2026-01-01T00:00:00.000Z",
    updatedAtUtc: "2026-01-01T00:00:00.000Z",
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function openDetail(item = makeItem()) {
  const { openItemDetailDialog } = await import("./item-detail");
  openItemDetailDialog({ item, onSaved: vi.fn(), onConflict: vi.fn() });
  await flush();
  return document.querySelector<HTMLFormElement>(".insight-dialog-panel")!;
}

describe("openItemDetailDialog action range boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    productivityListActions.mockReset();
    productivityCommitItemWithActions.mockReset();
    productivityListActions.mockResolvedValue({ actions: [] });
    productivityCommitItemWithActions.mockResolvedValue({
      item: makeItem(),
      actions: [],
    });
  });

  it("does not commit when a new action title is empty", async () => {
    const form = await openDetail();

    form.querySelector<HTMLButtonElement>('[data-action="add-action"]')!.click();
    await flush();

    const actionTitle = form.querySelector<HTMLInputElement>('[data-field="title"]')!;
    actionTitle.value = "";
    actionTitle.dispatchEvent(new Event("input", { bubbles: true }));

    form.requestSubmit();
    await flush();

    expect(productivityCommitItemWithActions).not.toHaveBeenCalled();
    expect(document.body.contains(form)).toBe(true);
    expect(form.querySelector(".insight-dialog-error")?.textContent).toContain("新安排标题不能为空");
  });

  it("does not commit or send null planned range fields for a partial range", async () => {
    const form = await openDetail();

    form.querySelector<HTMLButtonElement>('[data-action="add-action"]')!.click();
    await flush();

    const rangeRadio = form.querySelector<HTMLInputElement>('input[type="radio"][value="range"]')!;
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    form.requestSubmit();
    await flush();

    expect(productivityCommitItemWithActions).not.toHaveBeenCalled();
    expect(document.body.contains(form)).toBe(true);
    expect(form.querySelector(".insight-dialog-error")?.textContent).toContain("起止须填写完整");
  });
});

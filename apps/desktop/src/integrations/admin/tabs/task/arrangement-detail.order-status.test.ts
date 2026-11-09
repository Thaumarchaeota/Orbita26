import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionSnapshot, ItemSnapshot, ProjectSnapshot } from "../../../productivity/types";
import { mountArrangementDetail, type DetailData, type DetailSelection } from "./arrangement-detail";

vi.mock("../../../../ui/checkbox", () => ({
  createCheckbox: (checked = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = checked ? "is-checked" : "";
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(checked));
    return button;
  },
  readCheckbox: (element: HTMLElement) => element.classList.contains("is-checked"),
  setCheckbox: (element: HTMLElement, checked: boolean) => {
    element.classList.toggle("is-checked", checked);
    element.setAttribute("aria-checked", String(checked));
  },
  setCheckboxWithCompletionFeedback: (element: HTMLElement, completed: boolean) => {
    const wasChecked = element.classList.contains("is-checked");
    element.classList.toggle("is-checked", completed);
    element.setAttribute("aria-checked", String(completed));
    if (!completed) element.classList.remove("is-checking");
    else if (!wasChecked) element.classList.add("is-checking");
  },
}));
vi.mock("../../../../ui/insight-dialog", () => ({ createInsightDialog: vi.fn() }));
vi.mock("../../../../ui/decoupled-date-picker", () => ({ mountDecoupledDatePicker: () => ({ getValue: () => "", dispose() {}, setValue() {}, open() {}, close: async () => {} }) }));
vi.mock("../../../../ui/decoupled-time-picker", () => ({ mountDecoupledTimePicker: () => ({ getValue: () => "", dispose() {}, setValue() {}, open() {}, close: async () => {} }) }));
vi.mock("../../../../ui/decoupled-datetime-range-picker", () => ({ mountDecoupledDateTimeRangePicker: () => ({ getValue: () => ({ startDate: "", startTime: "", endDate: "", endTime: "" }), dispose() {}, setValue() {}, open() {}, close: async () => {} }) }));
vi.mock("../../../../ui/select-field", () => ({ mountSelectField: () => {
  const root = document.createElement("div");
  const button = document.createElement("button");
  root.append(button);
  return { getValue: () => null, getValues: () => new Set<string>(), setValue() {}, setValues() {}, setOptions() {}, setDisabled() {}, dispose() {}, root, button };
} }));

const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const instant = (hour: number, minute = 0) => `2026-10-16T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

function action(id: string, start: string | null, end: string | null, options: Partial<ActionSnapshot> = {}): ActionSnapshot {
  return {
    id, revision: 1, title: id, nameLinkMode: "unlinked", targetKind: "item", targetId: "item-a",
    plannedStartAt: start, plannedEndAt: end, ended: false, executionState: "未开始", intervals: [],
    createdAtUtc: "2026-10-01T00:00:00.000Z", updatedAtUtc: "2026-10-01T00:00:00.000Z",
    sessionId: "session-a", ...options,
  } as ActionSnapshot;
}

function mountPath(selection: DetailSelection, actions: ActionSnapshot[], onLifecycle = vi.fn(async () => {}), isWeek = false, enableIntervals = false) {
  const host = document.createElement("div");
  document.body.append(host);
  const item: ItemSnapshot = { id: "item-a", revision: 1, itemTypeId: null, tagIds: [], title: "Item", status: "进行中", priority: "none", createdAtUtc: "2026-10-01T00:00:00.000Z", updatedAtUtc: "2026-10-01T00:00:00.000Z" };
  const project: ProjectSnapshot = { id: "project-a", revision: 1, title: "Project", status: "进行中", tasks: [{ id: "task-a", projectId: "project-a", title: "Task", status: "进行中", createdAtUtc: "2026-10-01T00:00:00.000Z", updatedAtUtc: "2026-10-01T00:00:00.000Z" }], createdAtUtc: "2026-10-01T00:00:00.000Z", updatedAtUtc: "2026-10-01T00:00:00.000Z" };
  const renderedActions = actions.map((entry) => ({ ...entry,
    targetKind: selection?.kind === "task" ? "task" as const : "item" as const,
    targetId: selection?.kind === "task" ? "task-a" : "item-a",
  }));
  const data: DetailData = {
    actions: renderedActions, sessions: [{ id: "session-a", title: "Session", plannedStartAt: instant(7), plannedEndAt: instant(18) } as DetailData["sessions"][number]],
    items: [item], projects: [project], lists: [], itemTypes: [], tags: [], zone: { baseOffset: "+00:00", replacements: [] },
    targets: new Map([["item:item-a", { kind: "item", id: "item-a", title: "Item", path: "Item", color: "#000", available: true, archived: false }],
      ["task:task-a", { kind: "task", id: "task-a", title: "Task", path: "Project / Task", color: "#000", available: true, archived: false }]]),
  };
  const handle = mountArrangementDetail({
    host, getData: () => data, getSelection: () => selection, week: () => isWeek,
    onSelect: vi.fn(), onSaveAction: vi.fn(async () => {}), onSaveSession: vi.fn(async () => {}), onSaveItem: vi.fn(async () => {}),
    onSaveThingChoice: vi.fn(async () => {}), onExecute: vi.fn(async () => {}), onDelete: vi.fn(async () => {}),
    onCreateAction: vi.fn(async () => {}), onLifecycle, onError: vi.fn(),
    ...(enableIntervals ? { canEditIntervals: () => true, onEditInterval: vi.fn(async () => {}) } : {}),
  });
  return { host, handle, data, setSelection: (next: DetailSelection) => { selection = next; } };
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("arrangement detail action ordering and status", () => {
  it("refreshes saved intervals while their list remains expanded", () => {
    const { host, handle, data } = mountPath({ kind: "item", id: "item-a" }, [action("a", null, null)], undefined, true, true);
    host.querySelector<HTMLButtonElement>("[data-interval-toggle]")!.click();
    expect(host.querySelector<HTMLButtonElement>("[data-interval-toggle]")?.getAttribute("aria-expanded")).toBe("true");
    data.actions[0].intervals = [{ id: "interval-a", startedAt: instant(8), endedAt: instant(9), deletedAtUtc: null }] as ActionSnapshot["intervals"];
    handle.render();
    expect(host.querySelector('[data-interval-picker="interval-a"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>("[data-interval-toggle]")?.getAttribute("aria-expanded")).toBe("true");
    handle.dispose();
  });

  it("keeps an Item title editor alive across a background render", async () => {
    const { host, handle, data } = mountPath({ kind: "item", id: "item-a" }, []);
    host.querySelector<HTMLButtonElement>(".orbita-inline-text-field__display")!.click();
    const input = host.querySelector<HTMLInputElement>(".orbita-inline-text-field__input")!;
    input.value = "正在编辑";
    data.items[0].title = "后台更新";
    handle.render();
    expect(host.querySelector(".orbita-inline-text-field__input")).toBe(input);
    expect(input.value).toBe("正在编辑");
    input.blur();
    await vi.waitFor(() => expect(host.querySelector(".orbita-inline-text-field__display")?.textContent).toBe("后台更新"));
    handle.dispose();
  });

  it("does not close an open classification menu on background render", async () => {
    const { host, handle, data } = mountPath({ kind: "item", id: "item-a" }, []);
    const trigger = host.querySelector<HTMLButtonElement>(".arrangement-type-trigger")!;
    trigger.click();
    const search = document.querySelector<HTMLInputElement>(".orbita-flat-select-input")!;
    const popup = search.closest<HTMLElement>(".orbita-flat-select")!;
    await vi.waitFor(() => expect(popup.hidden).toBe(false));
    search.value = "工作";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    data.items[0].title = "刷新后的标题";
    handle.render();
    expect(host.querySelector(".arrangement-type-trigger")).toBe(trigger);
    expect(popup.hidden).toBe(false);
    expect(search.value).toBe("工作");
    trigger.click();
    await vi.waitFor(() => expect(host.querySelector(".orbita-inline-text-field__display")?.textContent).toBe("刷新后的标题"));
    handle.dispose();
  });

  it("preserves a Task title draft while allowing an explicit selection change", () => {
    const { host, handle, setSelection } = mountPath({ kind: "task", id: "task-a" }, []);
    host.querySelector<HTMLButtonElement>('[data-edit-title="task:task-a"]')!.click();
    const input = host.querySelector<HTMLInputElement>(".arrangement-inline-title-input")!;
    input.value = "未完成的标题";
    handle.render();
    expect(host.querySelector(".arrangement-inline-title-input")).toBe(input);
    expect(input.value).toBe("未完成的标题");
    setSelection({ kind: "item", id: "item-a" });
    handle.render();
    expect(host.querySelector(".arrangement-inline-title-input")).toBeNull();
    expect(host.querySelector(".orbita-inline-text-field__display")?.textContent).toBe("Item");
    handle.dispose();
  });

  it("opens sorting from the icon and applies its original sort options", async () => {
    const { host, handle } = mountPath(null, [action("second", null, null, { createdAtUtc: instant(4) }), action("first", null, null, { createdAtUtc: instant(3) })], undefined, true);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="待安排排序"]')!;
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(host.querySelector(".orbita-select-field")).toBeNull();
    trigger.click();
    await vi.waitFor(() => expect(document.querySelectorAll(".orbita-flat-select-option")).toHaveLength(3));
    expect([...document.querySelectorAll(".orbita-flat-select-option")].map((option) => option.textContent?.trim())).toEqual(["创建顺序", "按事情分组", "首字母"]);
    const group = [...document.querySelectorAll<HTMLButtonElement>(".orbita-flat-select-option")].find((option) => option.textContent?.trim() === "按事情分组")!;
    group.click();
    expect(host.querySelector(".arrangement-unscheduled-group")?.textContent).toBe("Item");
    handle.dispose();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
  });
  it("optimistically checks completion and restores it when the lifecycle write fails", async () => {
    let rejectWrite!: (error: Error) => void;
    const onLifecycle = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
    const { host, handle } = mountPath({ kind: "item", id: "item-a" }, [action("action-a", instant(8), instant(9))], onLifecycle);
    const checkbox = host.querySelector<HTMLButtonElement>("[data-completion]")!;

    checkbox.click();
    expect(checkbox.classList.contains("is-checked")).toBe(true);
    expect(checkbox.classList.contains("is-checking")).toBe(true);
    rejectWrite(new Error("write failed"));
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>("[data-completion]")?.classList.contains("is-checked")).toBe(false));
    handle.dispose();
  });

  it("orders actual Item, Task, and Session card render paths and applies ended/overdue precedence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const actions = [
      action("ended-no-start", null, null, { ended: true, executionState: "已结束", createdAtUtc: instant(2) }),
      action("paused-late", instant(10), instant(11), { executionState: "暂停" }),
      action("tie-b", instant(9), instant(10), { createdAtUtc: instant(3) }),
      action("ended-late", instant(10), instant(11), { ended: true, executionState: "已结束" }),
      action("running-late", instant(9, 30), instant(10), { executionState: "进行中" }),
      action("ended-tie-b", instant(7), instant(8), { ended: true, executionState: "已结束", createdAtUtc: instant(3) }),
      action("no-start", null, null),
      action("on-time", instant(8), instant(12)),
      action("tie-a", instant(9), instant(10), { createdAtUtc: instant(4) }),
      action("ended-tie-a", instant(7), instant(8), { ended: true, executionState: "已结束", createdAtUtc: instant(3) }),
    ];
    const expected = ["on-time", "tie-b", "tie-a", "running-late", "paused-late", "no-start", "ended-tie-a", "ended-tie-b", "ended-late", "ended-no-start"];
    const originalOrder = actions.map(({ id }) => id);

    for (const selection of [{ kind: "item", id: "item-a" }, { kind: "task", id: "task-a" }, { kind: "session", id: "session-a" }] as const) {
      const { host, handle, data } = mountPath(selection, actions);
      const cards = [...host.querySelectorAll<HTMLElement>("[data-action-card]")];
      expect(cards.map((card) => card.dataset.actionCard)).toEqual(expected);
      expect(cards.map((card) => card.dataset.railStatus)).toEqual([
        "planned", "overdue", "overdue", "running", "paused", "planned", "ended", "ended", "ended", "ended",
      ]);
      expect(data.actions.map(({ id }) => id)).toEqual(originalOrder);

      const byId = (id: string) => host.querySelector<HTMLElement>(`[data-action-card="${id}"]`)!;
      expect(byId("running-late").dataset.railStatus).toBe("running");
      expect(byId("paused-late").dataset.railStatus).toBe("paused");
      expect(byId("ended-late").dataset.railStatus).toBe("ended");
      expect(byId("no-start").dataset.railStatus).toBe("planned");
      expect(byId("on-time").dataset.railStatus).toBe("planned"); // End exactly at now is not overdue.

      const onTime = data.actions.find((entry) => entry.id === "on-time")!;
      onTime.plannedEndAt = instant(11, 59);
      handle.render();
      expect(byId("on-time").dataset.railStatus).toBe("overdue");
      onTime.ended = true;
      onTime.executionState = "已结束";
      handle.render();
      expect(host.querySelectorAll<HTMLElement>("[data-action-card]")[4].dataset.actionCard).toBe("no-start");
      expect(byId("on-time").dataset.railStatus).toBe("ended");
      onTime.ended = false;
      onTime.executionState = "未开始";
      handle.render();
      expect(host.querySelectorAll<HTMLElement>("[data-action-card]")[0].dataset.actionCard).toBe("on-time");
      expect(byId("on-time").dataset.railStatus).toBe("overdue");
      expect(vi.getTimerCount()).toBe(0);
      handle.dispose();
    }
  });
});

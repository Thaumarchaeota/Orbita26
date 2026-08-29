import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDetailFilter } from "../domain/filter-apply";
import {
  deserializePresetToFilterState,
  inferDatePresetFromFilter,
  serializeFilterState,
  type FilterPreset,
} from "../domain/filter-preset";
import { setDetailEntries, __testResetLedgerStore } from "../state/ledger-store";
import type { Entry } from "../types";
import { createCardDetailSnapshotStore } from "./snapshot-store";
import {
  applyFilterPresetToStore,
  applyFilterStateToStore,
  collectTagsFromDetailItems,
  isTypeFilterChecked,
  mountFinanceRailFilter,
} from "./finance-rail-filter";

vi.mock("../api/client", () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    write_target: "ledger/2026.bean",
    reporting_currency: "CNY",
    filter_presets: [
      {
        id: "preset-1",
        name: "日常",
        date: { mode: "relative", preset: "last7" },
        typeMode: "selected",
        types: ["expense"],
        accounts: [],
        accountMode: "or",
        tags: [],
        tagMode: "or",
      },
    ],
  }),
  updateSettings: vi.fn().mockImplementation(async (payload) => payload),
}));

const NOW = new Date(2026, 7, 22);

function makeEntry(id: string, tags = ""): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "shop",
    remark: "",
    tags,
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  __testResetLedgerStore();
});

describe("finance-rail-filter helpers", () => {
  it("marks all types checked in all mode", () => {
    const filter = defaultDetailFilter();
    expect(isTypeFilterChecked(filter.typeMode, filter.types, "expense")).toBe(true);
    expect(isTypeFilterChecked(filter.typeMode, filter.types, "pad")).toBe(true);
  });

  it("marks none checked when selected set is empty", () => {
    expect(isTypeFilterChecked("selected", new Set(), "expense")).toBe(false);
    expect(isTypeFilterChecked("selected", new Set(), "balance")).toBe(false);
  });

  it("collects unique sorted tags from transactions", () => {
    const tags = collectTagsFromDetailItems([
      makeEntry("e1", "trip food"),
      makeEntry("e2", "food"),
    ]);
    expect(tags).toEqual(["food", "trip"]);
  });

  it("round-trips preset date via inferDatePresetFromFilter", () => {
    const filter = {
      ...defaultDetailFilter(),
      dateFrom: "2026-08-16",
      dateTo: "2026-08-22",
    };
    expect(inferDatePresetFromFilter(filter, NOW)).toEqual({
      mode: "relative",
      preset: "last7",
    });
    const preset = serializeFilterState(filter, "p1", "近7天", inferDatePresetFromFilter(filter, NOW));
    const restored = deserializePresetToFilterState(preset, NOW);
    expect(restored.dateFrom).toBe("2026-08-16");
    expect(restored.dateTo).toBe("2026-08-22");
  });

  it("applyFilterStateToStore restores selected types", () => {
    const store = createCardDetailSnapshotStore();
    const state = {
      ...defaultDetailFilter(),
      typeMode: "selected" as const,
      types: new Set(["expense", "income"] as const),
      tags: new Set(["trip"]),
      tagMode: "and" as const,
    };
    applyFilterStateToStore(store, state);
    const snap = store.getSnapshot();
    expect(snap.filter.typeMode).toBe("selected");
    expect([...snap.filter.types]).toEqual(["expense", "income"]);
    expect([...snap.filter.tags]).toEqual(["trip"]);
    expect(snap.filter.tagMode).toBe("and");
    store.dispose();
  });

  it("applyFilterPresetToStore applies relative preset", () => {
    const store = createCardDetailSnapshotStore();
    const preset: FilterPreset = {
      id: "p1",
      name: "日常",
      date: { mode: "relative", preset: "today" },
      typeMode: "selected",
      types: ["expense"],
      accounts: [],
      accountMode: "or",
      tags: [],
      tagMode: "or",
    };
    applyFilterPresetToStore(store, preset, NOW);
    const snap = store.getSnapshot();
    expect(snap.filter.dateFrom).toBe("2026-08-22");
    expect(snap.filter.dateTo).toBe("2026-08-22");
    expect(snap.filter.typeMode).toBe("selected");
    expect([...snap.filter.types]).toEqual(["expense"]);
    store.dispose();
  });
});

describe("mountFinanceRailFilter", () => {
  it("renders 8-type grid with stripes and all checked by default", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    const cells = host.querySelectorAll<HTMLButtonElement>(".finance-rail-type-cell");
    expect(cells).toHaveLength(8);
    expect([...cells].every((c) => c.classList.contains("is-selected"))).toBe(true);
    expect(host.querySelectorAll(".finance-rail-type-stripe")).toHaveLength(8);
    dispose();
    store.dispose();
  });

  it("shows reset when filter active and clears on click", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    const resetBtn = host.querySelector<HTMLButtonElement>("[data-role='filter-reset']")!;
    expect(resetBtn.hidden).toBe(true);

    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    expect(resetBtn.hidden).toBe(false);

    resetBtn.click();
    expect(store.getSnapshot().filter.typeMode).toBe("all");
    expect(resetBtn.hidden).toBe(true);
    dispose();
    store.dispose();
  });

  it("type all button restores all types", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    store.dispatch({ type: "toggle-type", stripeKind: "expense" });
    expect(store.getSnapshot().filter.typeMode).toBe("selected");

    host.querySelector<HTMLButtonElement>("[data-role='type-all']")!.click();
    expect(store.getSnapshot().filter.typeMode).toBe("all");

    const cells = host.querySelectorAll<HTMLButtonElement>(".finance-rail-type-cell");
    expect([...cells].every((c) => c.classList.contains("is-selected"))).toBe(true);
    dispose();
    store.dispose();
  });

  it("syncs empty type grid when all types deselected", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    for (const kind of [
      "expense",
      "proxy-expense",
      "income",
      "transfer",
      "repayment",
      "unknown",
      "pad",
      "balance",
    ] as const) {
      store.dispatch({ type: "toggle-type", stripeKind: kind });
    }
    expect(store.getSnapshot().filter.types.size).toBe(0);

    const cells = host.querySelectorAll<HTMLButtonElement>(".finance-rail-type-cell");
    expect([...cells].every((c) => c.classList.contains("is-unselected"))).toBe(true);
    dispose();
    store.dispose();
  });

  it("loads presets without auto-applying filter", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    await vi.waitFor(() => {
      const btn = host.querySelector<HTMLButtonElement>("[data-role='preset-select']")!;
      expect(btn).toBeTruthy();
      btn.click();
      expect(document.querySelector('.orbita-simple-select-option[data-value="preset-1"]')).toBeTruthy();
    });
    expect(store.getSnapshot().filter.typeMode).toBe("all");

    document.querySelector<HTMLButtonElement>('.orbita-simple-select-option[data-value="preset-1"]')?.click();
    expect(store.getSnapshot().filter.typeMode).toBe("selected");
    expect([...store.getSnapshot().filter.types]).toEqual(["expense"]);

    dispose();
    store.dispose();
  });

  it("collects tags only when ledger fully loaded", async () => {
    setDetailEntries([makeEntry("e1", "trip"), makeEntry("e2", "food")]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const store = createCardDetailSnapshotStore();
    const dispose = mountFinanceRailFilter(host, store, new AbortController().signal);

    await vi.waitFor(() => {
      expect(host.querySelector(".orbita-tag-picker")).toBeTruthy();
    });
    dispose();
    store.dispose();
  });
});

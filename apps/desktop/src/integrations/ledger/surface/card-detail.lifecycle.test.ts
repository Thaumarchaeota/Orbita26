import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import { __testResetLedgerStore, setDetailEntries } from "../state/ledger-store";
import { mountCardDetailSurface } from "./card-detail-surface";
import { createLedgerCardStore } from "./ledger-card-store";

vi.mock("../api/client", () => ({
  fetchStats: vi.fn().mockResolvedValue({ ok: true, accounts: [] }),
}));

function makeEntry(id: string, date = "2026-08-09"): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date,
    flag: "*",
    payee: "shop",
    remark: "",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
  };
}

function rafTwice(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

describe("CardDetailSurface lifecycle (Phase B)", () => {
  beforeEach(() => {
    __testResetLedgerStore();
    document.body.replaceChildren();
  });

  it("does not paint after dispose", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const surface = mountCardDetailSurface(host, { store });
    surface.dispose();

    store.dispatch({ type: "set-date-from", value: "2026-08-01" });
    expect(host.querySelector("[data-role='card-detail-surface']")).toBeNull();
    store.dispose();
  });

  it("does not let disposed store subscription receive ledger mutations", async () => {
    setDetailEntries([makeEntry("e1")]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const firstStore = createLedgerCardStore();
    const first = mountCardDetailSurface(host, { store: firstStore });
    first.dispose();
    firstStore.dispose();

    const secondStore = createLedgerCardStore();
    const second = mountCardDetailSurface(host, { store: secondStore });
    setDetailEntries([makeEntry("e1"), makeEntry("e2", "2026-08-08")]);
    second.refresh();
    await rafTwice();
    expect(host.querySelectorAll(".cds-card-wrap").length).toBeGreaterThan(0);
    second.dispose();
    secondStore.dispose();
  });

  it("disposed surface scroll listener does not run paint", async () => {
    setDetailEntries(
      Array.from({ length: 20 }, (_, i) =>
        makeEntry(`e${i}`, `2026-08-${String(9 - Math.floor(i / 3)).padStart(2, "0")}`),
      ),
    );
    const store = createLedgerCardStore();
    const host = document.createElement("div");
    host.style.height = "200px";
    document.body.appendChild(host);
    const surface = mountCardDetailSurface(host, { store });
    const scroll = host.querySelector<HTMLElement>("[data-role='card-detail-scroll']")!;
    scroll.style.height = "200px";
    surface.refresh();
    await rafTwice();
    expect(host.querySelectorAll(".cds-card-wrap").length).toBeGreaterThan(0);
    surface.dispose();
    expect(host.querySelectorAll(".cds-card-wrap").length).toBe(0);
    scroll.dispatchEvent(new Event("scroll"));
    await rafTwice();
    expect(host.querySelectorAll(".cds-card-wrap").length).toBe(0);
    store.dispose();
  });

  it("keeps the list DOM and scroll position through an empty filter", async () => {
    setDetailEntries(Array.from({ length: 20 }, (_, index) => makeEntry(`e${index}`)));
    const store = createLedgerCardStore();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const surface = mountCardDetailSurface(host, { store });
    const scroll = host.querySelector<HTMLElement>("[data-role='card-detail-scroll']")!;
    await rafTwice();

    const retainedList = scroll.firstElementChild as HTMLElement;
    scroll.scrollTop = 120;
    store.dispatch({ type: "set-date-from", value: "2099-01-01" });
    await rafTwice();

    expect(scroll.querySelector("[data-role='card-detail-empty']")).not.toBeNull();
    expect(scroll.contains(retainedList)).toBe(true);
    expect(retainedList.hidden).toBe(true);

    store.dispatch({ type: "set-date-from", value: null });
    await rafTwice();

    expect(scroll.querySelector("[data-role='card-detail-empty']")).toBeNull();
    expect(scroll.firstElementChild).toBe(retainedList);
    expect(retainedList.hidden).toBe(false);
    expect(scroll.scrollTop).toBe(120);
    surface.dispose();
    store.dispose();
  });

  it("ledger onDetailMutated does not reach disposed card store", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    let notifyCount = 0;
    store.subscribe(() => {
      notifyCount += 1;
    });
    store.dispose();
    setDetailEntries([makeEntry("e2")]);
    expect(notifyCount).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "../types";
import { __testResetLedgerStore, setDetailEntries, __testEstablishBaseline } from "../state/ledger-store";
import { mountCdsEditing } from "./cds-editing";
import { patchTransactionCard, renderDetailItemCard } from "./render-cards";
import { createLedgerCardStore } from "./ledger-card-store";

function makeEntry(id: string): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "p",
    remark: "原标题",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
  };
}

beforeEach(() => {
  __testResetLedgerStore();
  document.body.replaceChildren();
});

describe("cds-editing", () => {
  it("commits edit on Enter and dispatches update-entry", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);

    const field = document.createElement("span");
    field.className = "cds-field";
    field.dataset.editable = "remark";
    field.textContent = "原标题";
    const wrap = document.createElement("div");
    wrap.className = "cds-card-wrap";
    wrap.dataset.itemId = "e1";
    wrap.appendChild(field);
    scroll.appendChild(wrap);

    field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = field.querySelector("input");
    expect(input).toBeTruthy();
    input!.value = "新标题";
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const item = store.getSnapshot().items[0] as Entry;
    expect(item.remark).toBe("新标题");
    editing.dispose();
    store.dispose();
  });

  it("cancels edit on Escape without dispatch", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);

    const field = document.createElement("span");
    field.className = "cds-field";
    field.dataset.editable = "remark";
    field.textContent = "原标题";
    const wrap = document.createElement("div");
    wrap.className = "cds-card-wrap";
    wrap.dataset.itemId = "e1";
    wrap.appendChild(field);
    scroll.appendChild(wrap);

    field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = field.querySelector("input")!;
    input.value = "不应保存";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect((store.getSnapshot().items[0] as Entry).remark).toBe("原标题");
    editing.dispose();
    store.dispose();
  });

  it("rejects invalid amount without coercing to zero", () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);

    const field = document.createElement("span");
    field.className = "cds-field";
    field.dataset.editable = "amount";
    field.dataset.postingIndex = "0";
    field.textContent = "10";
    const wrap = document.createElement("div");
    wrap.className = "cds-card-wrap";
    wrap.dataset.itemId = "e1";
    wrap.appendChild(field);
    scroll.appendChild(wrap);

    field.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = field.querySelector("input")!;
    input.value = "not-a-number";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect((store.getSnapshot().items[0] as Entry).postings[0]!.amount).toBe(10);
    expect(field.classList.contains("is-field-err")).toBe(true);
    editing.dispose();
    store.dispose();
  });

  it("commits single-side amount edit without balance blocking", () => {
    const entry = makeEntry("e1");
    setDetailEntries([entry]);
    __testEstablishBaseline([entry]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);

    const wrap = renderDetailItemCard(entry);
    scroll.appendChild(wrap);
    const amount = wrap.querySelector<HTMLElement>("[data-editable='amount']")!;
    amount.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = amount.querySelector("input")!;
    input.value = "15";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(amount.classList.contains("is-editing")).toBe(false);
    const updated = store.getSnapshot().items[0] as Entry;
    expect(updated.postings[0]!.amount).toBe(15);
    patchTransactionCard(wrap, updated);
    const card = wrap.querySelector<HTMLElement>(".cds-card")!;
    expect(card.classList.contains("is-modified")).toBe(true);
    expect(wrap.querySelector(".cds-posting-line.is-unbalanced")).toBeFalsy();

    store.dispatch({ type: "update-entry", id: "e1", patch: { field: "amount", postingIndex: 1, value: -15 } });
    const fixed = store.getSnapshot().items[0] as Entry;
    patchTransactionCard(wrap, fixed);
    expect(wrap.querySelector(".cds-posting-line.is-unbalanced")).toBeFalsy();

    editing.dispose();
    store.dispose();
  });

  it("keeps tag chips after tag edit commit", () => {
    const entry = { ...makeEntry("e1"), tags: "#food #travel" };
    setDetailEntries([entry]);
    __testEstablishBaseline([entry]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);

    const wrap = renderDetailItemCard(entry);
    scroll.appendChild(wrap);
    const tags = wrap.querySelector<HTMLElement>("[data-editable='tags']")!;
    tags.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tags.querySelector(".ledger-tag-box")).toBeTruthy();

    const tagField = tags.querySelector<HTMLInputElement>(".ledger-tag-field")!;
    tagField.value = "work";
    tagField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(tags.classList.contains("is-editing")).toBe(false);
    expect(tags.querySelector(".cds-tag-chip")).toBeTruthy();
    expect(tags.textContent).not.toContain("#food");
    const updated = store.getSnapshot().items[0] as Entry;
    expect(updated.tags).toContain("#work");

    editing.dispose();
    store.dispose();
  });

  it("sets, changes and clears time on the datetime popover", async () => {
    const entry = makeEntry("e1");
    entry.metadata = [
      { key: "bkeasy-type", value: "expense" },
      { key: "orbita-id", value: "txn_0123456789ABCDEFGHJKMNPQ" },
    ];
    setDetailEntries([entry]);
    __testEstablishBaseline([entry]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);
    const wrap = renderDetailItemCard(entry);
    scroll.appendChild(wrap);
    const time = wrap.querySelector<HTMLElement>("[data-editable='datetime']")!;
    expect(time.classList.contains("is-empty")).toBe(true);

    time.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    const popover = document.querySelector<HTMLElement>(".cds-datetime-popover")!;
    expect(popover).toBeTruthy();
    const input = popover.querySelector<HTMLInputElement>("input[type='time']")!;
    input.value = "08:05";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect((store.getSnapshot().items[0] as Entry).metadata).toContainEqual({
      key: "time",
      value: "2026-08-09T08:05:00+08:00",
    });

    time.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    const input2 = document.querySelector<HTMLElement>(".cds-datetime-popover")!.querySelector<HTMLInputElement>("input[type='time']")!;
    input2.value = "18:20";
    input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect((store.getSnapshot().items[0] as Entry).metadata?.find((m) => m.key === "time")?.value).toBe(
      "2026-08-09T18:20:00+08:00",
    );

    time.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    const input3 = document.querySelector<HTMLElement>(".cds-datetime-popover")!.querySelector<HTMLInputElement>("input[type='time']")!;
    input3.value = "";
    input3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect((store.getSnapshot().items[0] as Entry).metadata?.some((m) => m.key === "time")).toBe(false);
    expect(time.classList.contains("is-empty")).toBe(true);

    editing.dispose();
    store.dispose();
  });

  it("blocks illegal time from entering the work copy", async () => {
    setDetailEntries([makeEntry("e1")]);
    const store = createLedgerCardStore();
    const scroll = document.createElement("div");
    document.body.appendChild(scroll);
    const editing = mountCdsEditing(scroll, store);
    const wrap = renderDetailItemCard(makeEntry("e1"));
    scroll.appendChild(wrap);
    const time = wrap.querySelector<HTMLElement>("[data-editable='datetime']")!;
    time.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    const input = document.querySelector<HTMLElement>(".cds-datetime-popover")!.querySelector<HTMLInputElement>("input[type='time']")!;
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "24:00",
      set: () => undefined,
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect((store.getSnapshot().items[0] as Entry).metadata?.some((m) => m.key === "time")).toBeFalsy();
    const errorEl = document.querySelector<HTMLElement>(".cds-datetime-popover-error")!;
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.textContent).toMatch(/时间/);
    expect(document.querySelector(".cds-datetime-popover")).toBeTruthy();
    editing.dispose();
    store.dispose();
  });
});

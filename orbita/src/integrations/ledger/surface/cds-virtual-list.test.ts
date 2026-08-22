import { beforeEach, describe, expect, it } from "vitest";
import { ROW_HEIGHT_ESTIMATE, VIRTUAL_BUFFER_ABOVE_MIN, VIRTUAL_BUFFER_BELOW_MIN, LIST_FULL_MAX_COUNT } from "../constants";
import {
  computeGroupWindow,
  countBufferedCards,
  prefixOffsets,
} from "../domain/virtual-list";
import { groupItemsByDate, type DateGroup } from "./group-by-date";
import type { Entry } from "../types";
import { probeCardMotion } from "./card-surface-motion";
import { createCdsVirtualList } from "./cds-virtual-list";

function mountedGroupCount(scroll: HTMLElement): number {
  return scroll.querySelectorAll(".cds-date-group").length;
}

function makeEntry(
  id: string,
  date = "2026-08-09",
  remark = "",
  postingCount = 2,
): Entry {
  const postings =
    postingCount >= 2
      ? [
          { account: "Expenses:Food", amount: 10, currency: "CNY" },
          { account: "Assets:Cash", amount: -10, currency: "CNY" },
        ]
      : [{ account: "Expenses:Food", amount: 10, currency: "CNY" }];
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date,
    flag: "*",
    payee: "shop",
    remark,
    tags: "",
    postings,
    seq: "a",
  };
}

function estimateGroupOffsets(groups: DateGroup[]): number[] {
  const base = 1 + 44 + 22;
  return prefixOffsets(
    groups.map((group) => {
      let height = base;
      for (let i = 0; i < group.items.length; i++) {
        height += ROW_HEIGHT_ESTIMATE;
        if (i > 0) height += 12;
      }
      return height;
    }),
  );
}

function makeManyEntries(count: number): Entry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry(
      `e${i}`,
      `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      i % 5 === 0 ? "long remark" : "",
      i % 7 === 0 ? 1 : 2,
    ),
  );
}

function mountedCardCount(scroll: HTMLElement): number {
  return scroll.querySelectorAll(".cds-card-wrap").length;
}

describe("cds virtual list scroll stability", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("does not change scrollTop on scroll when visible range is unchanged", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      makeEntry(`e${i}`, `2026-08-${String(9 - Math.floor(i / 5)).padStart(2, "0")}`),
    );
    const scroll = document.createElement("div");
    scroll.className = "cds-scroll";
    scroll.style.height = "240px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);

    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();

    scroll.scrollTop = 400;
    const before = scroll.scrollTop;
    scroll.dispatchEvent(new Event("scroll"));
    expect(scroll.scrollTop).toBe(before);

    list.dispose();
  });

  it("does not rewrite scrollTop when visible range changes during scroll", () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      makeEntry(
        `e${i}`,
        `2026-08-${String(9 - Math.floor(i / 4)).padStart(2, "0")}`,
        i % 3 === 0 ? "long remark text" : "",
        i % 5 === 0 ? 1 : 2,
      ),
    );
    const scroll = document.createElement("div");
    scroll.className = "cds-scroll";
    scroll.style.height = "200px";
    scroll.style.overflow = "auto";
    scroll.style.overflowAnchor = "none";
    document.body.appendChild(scroll);

    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();

    scroll.scrollTop = 1200;
    const target = scroll.scrollTop;
    scroll.dispatchEvent(new Event("scroll"));
    expect(scroll.scrollTop).toBe(target);

    scroll.scrollTop = target + 40;
    const nudge = scroll.scrollTop;
    scroll.dispatchEvent(new Event("scroll"));
    expect(scroll.scrollTop).toBe(nudge);

    list.dispose();
  });

  it("keeps date group DOM structure with cds-date-items gutter", () => {
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => [makeEntry("e1"), makeEntry("e2", "2026-08-08")],
      getLoadState: () => "ready",
    });
    list.paint();

    expect(scroll.querySelector(".cds-date-group")).not.toBeNull();
    expect(scroll.querySelector(".cds-date-items")).not.toBeNull();
    expect(scroll.querySelector(".cds-date-pin")).not.toBeNull();
    expect(scroll.querySelector(".cds-date-pin-sentinel")).toBeNull();
    for (const pin of scroll.querySelectorAll<HTMLElement>(".cds-date-pin")) {
      expect(pin.classList.contains("is-stuck")).toBe(false);
    }
    list.dispose();
  });

  it("re-renders cards when item content changes but ids stay the same", () => {
    const items = [makeEntry("e1", "2026-08-09", "before")];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    expect(scroll.querySelector(".cds-field-remark")?.textContent).toBe("before");

    items[0] = makeEntry("e1", "2026-08-09", "after");
    list.refresh();
    expect(scroll.querySelector(".cds-field-remark")?.textContent).toBe("after");
    list.dispose();
  });

  it("reuses unchanged sibling card DOM when one item content changes", () => {
    const items = [
      makeEntry("e1", "2026-08-09", "before"),
      makeEntry("e2", "2026-08-09", "stable"),
    ];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    const stableBefore = scroll.querySelector<HTMLElement>('[data-item-id="e2"]');

    items[0] = makeEntry("e1", "2026-08-09", "after");
    list.refresh();

    expect(scroll.querySelector(".cds-field-remark")?.textContent).toBe("after");
    expect(scroll.querySelector<HTMLElement>('[data-item-id="e2"]')).toBe(stableBefore);
    list.dispose();
  });

  it("patches transaction card in place when content changes", () => {
    const items = [makeEntry("e1", "2026-08-09", "before")];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    const wrapBefore = scroll.querySelector<HTMLElement>('[data-item-id="e1"]');
    const cardBefore = wrapBefore?.querySelector(".cds-card");

    items[0] = makeEntry("e1", "2026-08-09", "after");
    list.refresh();

    expect(scroll.querySelector(".cds-field-remark")?.textContent).toBe("after");
    expect(scroll.querySelector<HTMLElement>('[data-item-id="e1"]')).toBe(wrapBefore);
    expect(scroll.querySelector(".cds-card")).toBe(cardBefore);
    list.dispose();
  });

  it("patches delete visual without replacing card DOM", () => {
    const items = [makeEntry("e1", "2026-08-09", "keep")];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    const wrapBefore = scroll.querySelector<HTMLElement>('[data-item-id="e1"]');
    const cardBefore = wrapBefore?.querySelector(".cds-card");

    items[0] = { ...makeEntry("e1", "2026-08-09", "keep"), _deleted: true };
    list.refresh();

    const wrapAfter = scroll.querySelector<HTMLElement>('[data-item-id="e1"]');
    expect(wrapAfter).toBe(wrapBefore);
    expect(wrapAfter?.querySelector(".cds-card")).toBe(cardBefore);
    expect(wrapAfter?.querySelector(".cds-card")?.classList.contains("is-deleted")).toBe(true);
    expect(wrapAfter?.querySelector(".cds-delete-btn")?.textContent).toBe("↩");
    list.dispose();
  });

  it("emits transition events when delete visual is patched on existing card", async () => {
    const items = [makeEntry("e1", "2026-08-09", "keep")];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    const wrap = scroll.querySelector<HTMLElement>('[data-item-id="e1"]')!;
    const card = wrap.querySelector<HTMLElement>(".cds-card")!;
    const deleted = { ...items[0]!, _deleted: true };
    await probeCardMotion(card, () => {
      items[0] = deleted;
      list.refresh();
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(card.classList.contains("is-deleted")).toBe(true);
    list.dispose();
  });

  it("toggles is-validation-err on existing card when marked errors change", () => {
    const items = [makeEntry("e1", "2026-08-09", "stable")];
    const scroll = document.createElement("div");
    scroll.style.height = "400px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);

    let marked = new Set<string>();
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
      getRenderContext: () => ({ markedErrorIds: marked }),
    });
    list.paint();
    const card = scroll.querySelector<HTMLElement>(".cds-card")!;
    expect(card.classList.contains("is-validation-err")).toBe(false);

    marked = new Set(["e1"]);
    list.refresh();
    expect(scroll.querySelector(".cds-card")).toBe(card);
    expect(card.classList.contains("is-validation-err")).toBe(true);

    marked = new Set();
    list.refresh();
    expect(card.classList.contains("is-validation-err")).toBe(false);
    list.dispose();
  });

  it("renders visible cards synchronously on scroll without waiting for rAF", () => {
    const items = makeManyEntries(520);
    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    scroll.style.overflowAnchor = "none";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();

    scroll.scrollTop = 12000;
    scroll.dispatchEvent(new Event("scroll"));

    expect(mountedGroupCount(scroll)).toBeGreaterThan(0);
    expect(mountedCardCount(scroll)).toBeGreaterThan(0);
    expect(scroll.querySelector(".cds-date-pin")).not.toBeNull();
    expect(scroll.querySelector(".cds-card-wrap")).not.toBeNull();
    list.dispose();
  });

  it("keeps keyed cards and classes during rapid scroll up and down", () => {
    const items = makeManyEntries(520);
    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    scroll.style.overflowAnchor = "none";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();

    const positions = [0, 8000, 16000, 12000, 4000, 20000, 6000, 18000, 10000];
    for (const top of positions) {
      scroll.scrollTop = top;
      scroll.dispatchEvent(new Event("scroll"));
      expect(mountedCardCount(scroll)).toBeGreaterThan(0);
      for (const wrap of scroll.querySelectorAll<HTMLElement>(".cds-card-wrap")) {
        expect(wrap.dataset.itemId).toBeTruthy();
        expect(wrap.querySelector(".cds-card")).not.toBeNull();
      }
    }
    list.dispose();
  });

  it("pre-renders complete date groups with configured card buffers in virtual mode", () => {
    const items = makeManyEntries(LIST_FULL_MAX_COUNT + 1);
    const groups = groupItemsByDate(items);
    const offsets = estimateGroupOffsets(groups);
    const scrollTop = offsets[Math.floor(groups.length / 2)]!;
    const window = computeGroupWindow(groups, offsets, scrollTop, 280, "down");
    const counts = countBufferedCards(groups, offsets, window, scrollTop, 280);

    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    scroll.style.overflowAnchor = "none";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    scroll.scrollTop = scrollTop;
    scroll.dispatchEvent(new Event("scroll"));

    expect(mountedCardCount(scroll)).toBeGreaterThan(VIRTUAL_BUFFER_ABOVE_MIN);
    expect(mountedCardCount(scroll)).toBeLessThan(items.length);
    expect(mountedGroupCount(scroll)).toBeGreaterThan(0);
    expect(counts.above).toBeGreaterThanOrEqual(VIRTUAL_BUFFER_ABOVE_MIN);
    expect(counts.below).toBeGreaterThanOrEqual(VIRTUAL_BUFFER_BELOW_MIN);
    list.dispose();
  });

  it("does not mutate DOM after dispose when measure rAF fires", async () => {
    const items = makeManyEntries(300);
    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    scroll.scrollTop = 9000;
    scroll.dispatchEvent(new Event("scroll"));
    const childCount = scroll.children.length;
    const cardCount = mountedCardCount(scroll);
    list.dispose();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(scroll.children.length).toBe(childCount);
    expect(mountedCardCount(scroll)).toBe(cardCount);
  });

  it("patches visible diagnostics without rebuilding mounted card nodes", () => {
    const items = makeManyEntries(120);
    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    let marked = new Set<string>();
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
      getRenderContext: () => ({ markedErrorIds: marked }),
    });
    list.paint();
    const wrap = scroll.querySelector<HTMLElement>(".cds-card-wrap")!;
    const card = wrap.querySelector(".cds-card")!;
    const id = wrap.dataset.itemId!;

    marked = new Set([id]);
    list.refresh();
    expect(wrap.querySelector(".cds-card")).toBe(card);
    expect(card.classList.contains("is-validation-err")).toBe(true);
    list.dispose();
  });

  it("patches delete visual synchronously without full reconcile", () => {
    const items = makeManyEntries(200);
    const scroll = document.createElement("div");
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => items,
      getLoadState: () => "ready",
    });
    list.paint();
    const before = list.getScheduler().fullReconcileCount;
    const wrap = scroll.querySelector<HTMLElement>('[data-item-id="e0"]')!;
    const card = wrap.querySelector(".cds-card")!;
    items[0] = { ...makeEntry("e0", items[0]!.date), _deleted: true };
    list.refresh();
    expect(card.classList.contains("is-deleted")).toBe(true);
    expect(list.getScheduler().fullReconcileCount).toBe(before);
    expect(list.getScheduler().patchCount).toBeGreaterThan(0);
    list.dispose();
  });
});

describe("cds adaptive list render mode", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  function mountList(seed: Entry[]) {
    const state = { items: seed };
    const scroll = document.createElement("div");
    scroll.className = "cds-scroll";
    scroll.style.height = "280px";
    scroll.style.overflow = "auto";
    scroll.style.overflowAnchor = "none";
    document.body.appendChild(scroll);
    const list = createCdsVirtualList(scroll, {
      getItems: () => state.items,
      getLoadState: () => "ready",
    });
    return {
      scroll,
      list,
      setItems(next: Entry[]) {
        state.items = next;
      },
    };
  }

  it("uses full mode below 10,000 and virtual mode above", () => {
    const full = mountList(makeManyEntries(500));
    full.list.paint();
    expect(full.scroll.dataset.cdsListMode).toBe("full");
    expect(full.scroll.querySelector(".cds-virtual-spacer")).toBeNull();
    expect(mountedCardCount(full.scroll)).toBe(500);
    full.list.dispose();

    const virtual = mountList(makeManyEntries(LIST_FULL_MAX_COUNT + 1));
    virtual.list.paint();
    expect(virtual.scroll.dataset.cdsListMode).toBe("virtual");
    expect(virtual.scroll.querySelector(".cds-virtual-spacer")).not.toBeNull();
    expect(mountedCardCount(virtual.scroll)).toBeLessThan(LIST_FULL_MAX_COUNT + 1);
    virtual.list.dispose();
  });

  it("returns to full at or below 10,000 with no hysteresis", () => {
    const all = makeManyEntries(LIST_FULL_MAX_COUNT + 1);
    const { scroll, list, setItems } = mountList(all);
    list.paint();
    expect(scroll.dataset.cdsListMode).toBe("virtual");

    setItems(all.slice(0, 500));
    list.refresh();
    expect(scroll.dataset.cdsListMode).toBe("full");
    expect(scroll.querySelector(".cds-virtual-spacer")).toBeNull();
    expect(mountedCardCount(scroll)).toBe(500);
    list.dispose();
  });

  it("preserves scroll anchor across mode switch", () => {
    const all = makeManyEntries(LIST_FULL_MAX_COUNT + 1);
    const { scroll, list, setItems } = mountList(all);
    list.paint();
    scroll.scrollTop = 2400;
    scroll.dispatchEvent(new Event("scroll"));
    const beforeScroll = scroll.scrollTop;

    setItems(all.slice(0, 500));
    list.refresh();

    expect(scroll.dataset.cdsListMode).toBe("full");
    expect(mountedCardCount(scroll)).toBe(500);
    expect(Math.abs(scroll.scrollTop - beforeScroll)).toBeLessThan(8);
    list.dispose();
  });

  it("renders all cards in full mode during rapid scroll", () => {
    for (const count of [500]) {
      const { scroll, list } = mountList(makeManyEntries(count));
      list.paint();
      expect(scroll.dataset.cdsListMode).toBe("full");
      for (const top of [0, 4000, 8000, 2000, 6000]) {
        scroll.scrollTop = top;
        scroll.dispatchEvent(new Event("scroll"));
        expect(mountedCardCount(scroll)).toBe(count);
        expect(scroll.querySelector(".cds-virtual-spacer")).toBeNull();
      }
      list.dispose();
    }
  });

  it("virtual mode keeps viewport cards on rapid scroll", () => {
    const { scroll, list } = mountList(makeManyEntries(LIST_FULL_MAX_COUNT + 1));
    list.paint();
    expect(scroll.dataset.cdsListMode).toBe("virtual");
    for (const top of [0, 12000, 24000, 18000, 6000]) {
      scroll.scrollTop = top;
      scroll.dispatchEvent(new Event("scroll"));
      expect(mountedCardCount(scroll)).toBeGreaterThan(0);
      expect(mountedCardCount(scroll)).toBeLessThan(LIST_FULL_MAX_COUNT + 1);
    }
    list.dispose();
  });

  it("does not mutate DOM after dispose when async work was scheduled", async () => {
    const { scroll, list } = mountList(makeManyEntries(LIST_FULL_MAX_COUNT + 1));
    list.paint();
    scroll.scrollTop = 18000;
    scroll.dispatchEvent(new Event("scroll"));
    const childCount = scroll.children.length;
    const cardCount = mountedCardCount(scroll);
    list.dispose();

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    expect(scroll.children.length).toBe(childCount);
    expect(mountedCardCount(scroll)).toBe(cardCount);
  });
});

import type { Entry } from "../types";
import { createCdsVirtualList } from "./cds-virtual-list";
import "./card-detail-surface.css";

function seedLedgerVars(): void {
  const root = document.documentElement;
  root.style.setProperty("--ledger-text", "#111827");
  root.style.setProperty("--ledger-muted", "#6b7280");
  root.style.setProperty("--ledger-border", "#e5e7eb");
  root.style.setProperty("--ledger-surface", "#ffffff");
  root.style.setProperty("--ledger-hover", "#f3f4f6");
  root.style.setProperty("--ledger-accent", "#2563eb");
  root.style.setProperty("--ledger-accent-bg", "#eff6ff");
  root.style.setProperty("--ledger-danger", "#dc2626");
}

function makeEntry(
  id: string,
  date: string,
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

export type CdsHarnessHandle = {
  scrollMid: () => number;
  nudgeScroll: (delta: number) => number;
  rapidScroll: () => { passes: number; cardsAfter: number };
  getScrollTop: () => number;
  getMaxScroll: () => number;
  dispose: () => void;
};

declare global {
  interface Window {
    __CDS_HARNESS__?: () => CdsHarnessHandle;
    __CDS_HARNESS_DISPOSE__?: () => void;
  }
}

let harnessHandle: CdsHarnessHandle | null = null;

window.__CDS_HARNESS__ = (): CdsHarnessHandle => {
  if (harnessHandle) return harnessHandle;
  seedLedgerVars();
  const items = Array.from({ length: 520 }, (_, i) =>
    makeEntry(
      `e${i}`,
      `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      i % 4 === 0 ? "extra long remark that wraps across multiple visual lines in the card" : "",
      i % 7 === 0 ? 1 : 2,
    ),
  );

  const scroll = document.getElementById("cds-scroll")!;
  scroll.style.height = "360px";
  scroll.style.width = "520px";
  scroll.style.overflow = "auto";
  scroll.style.overflowAnchor = "none";

  const list = createCdsVirtualList(scroll, {
    getItems: () => items,
    getLoadState: () => "ready",
  });
  list.paint();

  harnessHandle = {
    scrollMid: () => {
      const max = scroll.scrollHeight - scroll.clientHeight;
      scroll.scrollTop = Math.floor(max * 0.48);
      scroll.dispatchEvent(new Event("scroll"));
      return scroll.scrollTop;
    },
    nudgeScroll: (delta: number) => {
      scroll.scrollTop += delta;
      scroll.dispatchEvent(new Event("scroll"));
      return scroll.scrollTop;
    },
    rapidScroll: () => {
      const positions = [0, 12000, 24000, 18000, 6000, 30000, 9000, 21000, 15000];
      for (const top of positions) {
        scroll.scrollTop = top;
        scroll.dispatchEvent(new Event("scroll"));
      }
      return {
        passes: positions.length,
        cardsAfter: scroll.querySelectorAll(".cds-card-wrap").length,
      };
    },
    getScrollTop: () => scroll.scrollTop,
    getMaxScroll: () => scroll.scrollHeight - scroll.clientHeight,
    dispose: () => list.dispose(),
  };
  return harnessHandle;
};

window.__CDS_HARNESS_DISPOSE__ = () => {
  if (harnessHandle) {
    harnessHandle.dispose();
    harnessHandle = null;
  }
};

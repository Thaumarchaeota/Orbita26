import type { Entry } from "../types";
import { __testEstablishBaseline } from "../state/ledger-store";
import { createCdsVirtualList } from "./cds-virtual-list";
import {
  mountConnectedCardVisual,
  probeCardMotion,
  transitionCardVisualState,
} from "./card-surface-motion";
import { renderDetailItemCard, patchTransactionCard } from "./render-cards";
import "./card-detail-surface.css";

function seedLedgerVars(): void {
  const root = document.documentElement;
  root.style.setProperty("--ledger-text", "#111827");
  root.style.setProperty("--ledger-muted", "#6b7280");
  root.style.setProperty("--ledger-border", "#e5e7eb");
  root.style.setProperty("--ledger-surface", "#ffffff");
  root.style.setProperty("--ledger-hover", "#f3f4f6");
  root.style.setProperty("--entry-border", "#e5e7eb");
}

function makeEntry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    kind: "transaction",
    id,
    source_file: "ledger/2026.bean",
    source_line: 1,
    type: "expense",
    date: "2026-08-09",
    flag: "*",
    payee: "shop",
    remark: "motion",
    tags: "",
    postings: [
      { account: "Expenses:Food", amount: 10, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
    seq: "a",
    ...overrides,
  };
}

export type CdsMotionScenarioResult = {
  scenario: string;
  reducedMotion: boolean;
  transitionDuration: string;
  events: string[];
  classes: string[];
};

export type CdsMotionHarnessResult = {
  reducedMotion: boolean;
  scenarios: CdsMotionScenarioResult[];
};

declare global {
  interface Window {
    __CDS_MOTION_HARNESS__?: () => Promise<CdsMotionHarnessResult>;
  }
}

async function waitFrames(count = 2): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

window.__CDS_MOTION_HARNESS__ = async (): Promise<CdsMotionHarnessResult> => {
  seedLedgerVars();
  document.body.replaceChildren();
  const host = document.createElement("div");
  host.id = "cds-motion-host";
  host.style.width = "520px";
  document.body.appendChild(host);

  const scenarios: CdsMotionScenarioResult[] = [];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const base = makeEntry("e-mod");
  __testEstablishBaseline([base]);
  const modified = {
    ...base,
    postings: base.postings.map((p, i) => (i === 0 ? { ...p, amount: 15 } : p)),
  };
  const modWrap = renderDetailItemCard(base);
  host.appendChild(modWrap);
  patchTransactionCard(modWrap, modified);
  const modCard = modWrap.querySelector<HTMLElement>(".cds-card")!;
  scenarios.push({
    scenario: "modified-yellow",
    reducedMotion,
    transitionDuration: getComputedStyle(modCard).transitionDuration,
    events: modCard.classList.contains("is-modified") ? ["class:is-modified"] : [],
    classes: [...modCard.classList],
  });

  const validationErr = makeEntry("e-unbal", {
    postings: [
      { account: "Expenses:Food", amount: 15, currency: "CNY" },
      { account: "Assets:Cash", amount: -10, currency: "CNY" },
    ],
  });
  const unbalWrap = renderDetailItemCard(validationErr, {
    markedErrorIds: new Set(["e-unbal"]),
    cardDiagnostics: new Map([
      ["e-unbal", [{ message: "Balance failed", item_ids: ["e-unbal"] }]],
    ]),
  });
  host.appendChild(unbalWrap);
  scenarios.push({
    scenario: "validation-err",
    reducedMotion,
    transitionDuration: getComputedStyle(unbalWrap.querySelector(".cds-card")!).transitionDuration,
    events: unbalWrap.querySelector(".cds-card.is-validation-err")
      ? ["class:is-validation-err"]
      : [],
    classes: [...unbalWrap.querySelector(".cds-card")!.classList],
  });

  const fresh = makeEntry("e-new", { _is_new: true });
  const newWrap = renderDetailItemCard(fresh);
  host.appendChild(newWrap);
  mountConnectedCardVisual(newWrap, "new", false);
  await waitFrames(3);
  const newCard = newWrap.querySelector<HTMLElement>(".cds-card")!;
  scenarios.push({
    scenario: "new-enter",
    reducedMotion,
    transitionDuration: getComputedStyle(newCard).transitionDuration,
    events: newCard.classList.contains("is-new") ? ["class:is-new"] : [],
    classes: [...newCard.classList],
  });

  const del = makeEntry("e-del");
  const delWrap = renderDetailItemCard(del);
  host.appendChild(delWrap);
  const delCard = delWrap.querySelector<HTMLElement>(".cds-card")!;
  const deleteProbe = await probeCardMotion(delCard, () => {
    transitionCardVisualState(delCard, "is-deleted", false);
  });
  scenarios.push({
    scenario: "delete-red",
    reducedMotion: deleteProbe.reducedMotion,
    transitionDuration: deleteProbe.transitionDuration,
    events: deleteProbe.events,
    classes: [...delCard.classList],
  });

  const scroll = document.createElement("div");
  scroll.style.height = "200px";
  scroll.style.overflow = "auto";
  host.appendChild(scroll);
  const items = [makeEntry("e-list", { remark: "list" })];
  __testEstablishBaseline(items);
  const list = createCdsVirtualList(scroll, {
    getItems: () => items,
    getLoadState: () => "ready",
  });
  list.paint();
  await waitFrames(3);
  const listWrap = scroll.querySelector<HTMLElement>('[data-item-id="e-list"]')!;
  const listCard = listWrap.querySelector<HTMLElement>(".cds-card")!;
  const deletedItem = { ...items[0]!, _deleted: true };
  const listDeleteProbe = await probeCardMotion(listCard, () => {
    patchTransactionCard(listWrap, deletedItem);
  });
  await waitFrames(3);
  scenarios.push({
    scenario: "delete-virtual-list",
    reducedMotion: listDeleteProbe.reducedMotion,
    transitionDuration: listDeleteProbe.transitionDuration,
    events: listDeleteProbe.events,
    classes: [...listCard.classList],
  });

  const itemsRefresh = [makeEntry("e-del-refresh", { remark: "refresh" })];
  const scrollRefresh = document.createElement("div");
  scrollRefresh.style.height = "200px";
  scrollRefresh.style.overflow = "auto";
  host.appendChild(scrollRefresh);
  const listRefresh = createCdsVirtualList(scrollRefresh, {
    getItems: () => itemsRefresh,
    getLoadState: () => "ready",
  });
  listRefresh.paint();
  await waitFrames(3);
  const refreshWrap = scrollRefresh.querySelector<HTMLElement>('[data-item-id="e-del-refresh"]')!;
  const refreshCard = refreshWrap.querySelector<HTMLElement>(".cds-card")!;
  const refreshProbe = await probeCardMotion(refreshCard, () => {
    itemsRefresh[0] = { ...itemsRefresh[0]!, _deleted: true };
    listRefresh.refresh();
  });
  scenarios.push({
    scenario: "delete-virtual-list-refresh",
    reducedMotion: refreshProbe.reducedMotion,
    transitionDuration: refreshProbe.transitionDuration,
    events: refreshProbe.events,
    classes: [...refreshCard.classList],
  });
  listRefresh.dispose();

  list.dispose();

  return { reducedMotion, scenarios };
};

import type { CardDetailStore } from "./types";
import { mountBalanceAuditShell } from "./balance-audit-shell";
import { mountCdsComposer } from "./cds-composer";
import "./finance-rail.css";

export function mountFinanceRail(
  container: HTMLElement,
  signal: AbortSignal,
  store: CardDetailStore,
): { dispose: () => void; getScrollEl: () => HTMLElement } {
  const scroll = document.createElement("div");
  scroll.className = "finance-rail-scroll";
  scroll.setAttribute("data-role", "finance-rail-scroll");

  const composerMount = document.createElement("div");
  composerMount.className = "finance-rail-composer";
  composerMount.setAttribute("data-role", "composer-mount");

  const auditMount = document.createElement("div");
  auditMount.className = "finance-rail-audit";
  auditMount.setAttribute("data-role", "balance-audit-mount");

  scroll.append(composerMount, auditMount);
  container.replaceChildren(scroll);

  const disposeComposer = mountCdsComposer(composerMount, store, signal);
  const disposeAudit = mountBalanceAuditShell(auditMount, signal, {
    getAudit: () => store.getSnapshot().balanceAudit,
    isDirty: () => store.getSnapshot().isDirty,
    subscribe: (fn) => store.subscribe(fn),
  });

  const onAbort = () => container.replaceChildren();
  signal.addEventListener("abort", onAbort);

  return {
    getScrollEl: () => scroll,
    dispose: () => {
      signal.removeEventListener("abort", onAbort);
      disposeComposer();
      disposeAudit();
      container.replaceChildren();
    },
  };
}

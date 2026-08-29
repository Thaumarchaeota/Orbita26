import type { CardDetailStore } from "./types";
import { probeCardMotion, transitionCardVisualState } from "./card-surface-motion";
import { patchTransactionCard } from "./render-cards";
import type { Entry } from "../types";
import { isTransactionItem } from "../domain/detail-item";

export type CdsSurfaceMotionDiag = {
  reducedMotion: boolean;
  transitionDuration: string;
  events: string[];
  cardClasses: string[];
};

declare global {
  interface Window {
    __CDS_MOTION_SURFACE_DIAG__?: () => Promise<CdsSurfaceMotionDiag>;
  }
}

export function installCdsMotionSurfaceDiag(
  scroll: HTMLElement,
  store: CardDetailStore,
): void {
  if (localStorage.getItem("orbitaCdsMotionDiag") !== "1") return;

  window.__CDS_MOTION_SURFACE_DIAG__ = async (): Promise<CdsSurfaceMotionDiag> => {
    const wrap = scroll.querySelector<HTMLElement>(".cds-card-wrap");
    const card = wrap?.querySelector<HTMLElement>(".cds-card");
    if (!wrap || !card) {
      return {
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        transitionDuration: "",
        events: ["error:no-card"],
        cardClasses: [],
      };
    }

    const item = store.getSnapshot().items.find((e) => e.id === wrap.dataset.itemId);
    if (item && isTransactionItem(item)) {
      const edited: Entry = {
        ...item,
        postings: item.postings.map((p, i) => (i === 0 ? { ...p, amount: p.amount + 5 } : p)),
      };
      patchTransactionCard(wrap, edited);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }

    const probe = await probeCardMotion(card, () => {
      transitionCardVisualState(card, "is-deleted", false);
    });

    return {
      reducedMotion: probe.reducedMotion,
      transitionDuration: probe.transitionDuration,
      events: probe.events,
      cardClasses: [...card.classList],
    };
  };
}

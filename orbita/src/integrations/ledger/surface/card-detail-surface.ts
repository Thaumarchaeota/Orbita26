import { collectValidationMarkedEntryIds, groupValidationErrorsByItemId } from "../domain/validation-errors";

import { mountCdsEditing } from "./cds-editing";

import { createCdsVirtualList } from "./cds-virtual-list";

import { installCdsMotionSurfaceDiag } from "./cds-motion-diag";

import type { CardDetailHandle, CardDetailStore } from "./types";

import "./card-detail-surface.css";



export type CardDetailSurfaceOptions = {

  store: CardDetailStore;

};



function renderLoading(scroll: HTMLElement): void {

  const node = document.createElement("div");

  node.className = "cds-loading";

  node.setAttribute("data-role", "card-detail-loading");

  const spinner = document.createElement("span");

  spinner.className = "ledger-loading-spinner";

  spinner.setAttribute("aria-hidden", "true");

  const text = document.createElement("p");

  text.textContent = "加载明细…";

  node.append(spinner, text);

  scroll.replaceChildren(node);

}



function renderError(scroll: HTMLElement, message: string): void {

  const node = document.createElement("div");

  node.className = "cds-error";

  node.setAttribute("data-role", "card-detail-error");

  node.textContent = message || "加载失败";

  scroll.replaceChildren(node);

}



function renderEmpty(scroll: HTMLElement): void {

  const empty = document.createElement("div");

  empty.className = "cds-empty";

  empty.setAttribute("data-role", "card-detail-empty");

  empty.textContent = "暂无条目";

  scroll.replaceChildren(empty);

}



export function mountCardDetailSurface(

  container: HTMLElement,

  options: CardDetailSurfaceOptions,

): CardDetailHandle {

  const { store } = options;

  let disposed = false;

  let virtualList: ReturnType<typeof createCdsVirtualList> | null = null;

  let globalErrorEl: HTMLElement | null = null;



  const surface = document.createElement("div");

  surface.className = "cds-root";

  surface.setAttribute("data-role", "card-detail-surface");



  const scroll = document.createElement("div");

  scroll.className = "cds-scroll";

  scroll.setAttribute("data-role", "card-detail-scroll");

  scroll.setAttribute("tabindex", "0");



  surface.append(scroll);

  container.replaceChildren(surface);



  const editing = mountCdsEditing(scroll, store);

  store.setCommitEdit?.(() => editing.commitEdit());



  function renderContext() {

    const snap = store.getSnapshot();

    return {

      markedErrorIds: new Set(collectValidationMarkedEntryIds([...snap.validationErrors])),

      cardDiagnostics: groupValidationErrorsByItemId([...snap.validationErrors]),

    };

  }



  function syncGlobalError(): void {

    const snap = store.getSnapshot();

    const msgs = snap.globalValidationErrors;

    if (!msgs.length) {

      globalErrorEl?.remove();

      globalErrorEl = null;

      return;

    }

    if (!globalErrorEl) {

      globalErrorEl = document.createElement("div");

      globalErrorEl.className = "cds-global-validation-err";

      globalErrorEl.setAttribute("data-role", "card-detail-global-error");

      surface.insertBefore(globalErrorEl, scroll);

    }

    globalErrorEl.replaceChildren();

    for (const msg of msgs) {

      const line = document.createElement("div");

      line.className = "cds-global-validation-line";

      line.textContent = msg;

      globalErrorEl.appendChild(line);

    }

  }



  let motionDiagInstalled = false;



  function ensureVirtualList(): ReturnType<typeof createCdsVirtualList> {

    if (!virtualList) {

      virtualList = createCdsVirtualList(scroll, {

        getItems: () => store.getSnapshot().items,

        getLoadState: () => {

          const state = store.getSnapshot().loadState;

          return state === "error" ? "loading" : state;

        },

        getRenderContext: () => renderContext(),

        loadOlder: store.tryLoadOlder,

      });

      if (!motionDiagInstalled) {

        installCdsMotionSurfaceDiag(scroll, store);

        motionDiagInstalled = true;

      }

    }

    return virtualList;

  }



  function paint(): void {

    if (disposed) return;

    const snapshot = store.getSnapshot();

    syncGlobalError();



    if (snapshot.focusRequest) {

      const focusId = snapshot.focusRequest;

      store.dispatch({ type: "consume-focus" });

      requestAnimationFrame(() => {

        virtualList?.scrollToItem(focusId);

      });

    }



    if (snapshot.loadState === "loading") {

      virtualList?.dispose();

      virtualList = null;

      renderLoading(scroll);

      return;

    }



    if (snapshot.loadState === "error") {

      virtualList?.dispose();

      virtualList = null;

      renderError(scroll, snapshot.error || "加载失败");

      return;

    }



    if (!snapshot.items.length) {

      virtualList?.dispose();

      virtualList = null;

      renderEmpty(scroll);

      return;

    }



    ensureVirtualList().refresh();

  }



  const unsubscribe = store.subscribe(paint);

  paint();



  const layoutRoot = container.closest<HTMLElement>(".ledger-page");

  const onLayoutLock = (event: Event) => {

    const locked = (event as CustomEvent<{ locked: boolean }>).detail?.locked ?? false;

    virtualList?.setLayoutLocked(locked);

  };

  layoutRoot?.addEventListener("orbita-finance-layout-lock", onLayoutLock);



  return {

    getScrollTargets() {

      return { primary: scroll };

    },

    focusItem(id: string) {

      virtualList?.scrollToItem(id);

      const target = scroll.querySelector<HTMLElement>(`[data-item-id="${id}"]`);

      target?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    },

    refresh: paint,

    async animateCommitRemovals(ids: string[]) {

      await virtualList?.animateCommitRemovals(ids);

    },

    dispose() {

      if (disposed) return;

      disposed = true;

      virtualList?.dispose();

      virtualList = null;

      editing.dispose();

      unsubscribe();

      layoutRoot?.removeEventListener("orbita-finance-layout-lock", onLayoutLock);

      container.replaceChildren();

    },

  };

}


import { escHtml } from "../../core/html";

export type RailDescriptor = {
  kind: string;
  title: string;
  renderContent: (host: HTMLElement) => void | (() => void);
  selectedKey: string;
  onSelect: (key: string) => void;
  onCreate?: () => void;
};

export type SecondaryRailController = {
  setDescriptor: (desc: RailDescriptor | null) => void;
  refreshGeometry: () => void;
  preferredWidth: () => number;
  isUserExpanded: () => boolean;
  syncChrome: () => void;
  dispose: () => void;
};

export const LEGACY_CHAT_RAIL_COLLAPSE_KEY = "orbita.insight.chatRailCollapsed";
export const SECONDARY_RAIL_STORAGE_KEY = "orbita.insight.secondaryRail";
export const INSIGHT_SECONDARY_RAIL_TOGGLE_EVENT = "orbita:insight-secondary-rail-toggle";
/** @deprecated use INSIGHT_SECONDARY_RAIL_TOGGLE_EVENT */
export const INSIGHT_CHAT_RAIL_TOGGLE_EVENT = INSIGHT_SECONDARY_RAIL_TOGGLE_EVENT;

const MIN_WIDTH = 160;
const MAX_WIDTH = 400;

type PersistedRailState = {
  collapsed: boolean;
  width: number;
  customWidth: boolean;
};

type SecondaryRailControllerOptions = {
  toggle: HTMLButtonElement;
  railHost: HTMLElement;
  railResize: HTMLElement;
  onGeometryChange: () => void;
  getEffectiveWidth: () => number;
  getEffectiveMin: () => number;
  getEffectiveMax: () => number;
};

type RailDragState =
  | { phase: "idle" }
  | {
      phase: "dragging";
      pointerId: number | "keyboard";
      startDesired: number;
      preview: number;
    };

let migrated = false;

function themeDefaultWidth(): number {
  return 232;
}

function resolveCustomWidth(parsed: Partial<PersistedRailState>): boolean {
  return parsed.customWidth === true;
}

function parsePersistedState(parsed: Partial<PersistedRailState>): PersistedRailState | null {
  if (typeof parsed.collapsed !== "boolean") return null;
  const width =
    typeof parsed.width === "number"
      ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width))
      : themeDefaultWidth();
  return {
    collapsed: parsed.collapsed,
    width,
    customWidth: resolveCustomWidth(parsed),
  };
}

function migrateLegacyCollapsed(): boolean {
  try {
    return localStorage.getItem(LEGACY_CHAT_RAIL_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function loadPersistedState(): PersistedRailState {
  if (!migrated) {
    migrated = true;
    try {
      const raw = localStorage.getItem(SECONDARY_RAIL_STORAGE_KEY);
      if (raw) {
        const parsed = parsePersistedState(JSON.parse(raw) as Partial<PersistedRailState>);
        if (parsed) return parsed;
      }
    } catch {
      /* ignore */
    }
    const state: PersistedRailState = {
      collapsed: migrateLegacyCollapsed(),
      width: themeDefaultWidth(),
      customWidth: false,
    };
    savePersistedState(state);
    return state;
  }
  try {
    const raw = localStorage.getItem(SECONDARY_RAIL_STORAGE_KEY);
    if (raw) {
      const parsed = parsePersistedState(JSON.parse(raw) as Partial<PersistedRailState>);
      if (parsed) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { collapsed: false, width: themeDefaultWidth(), customWidth: false };
}

function savePersistedState(state: PersistedRailState): void {
  try {
    const payload: { collapsed: boolean; width: number; customWidth?: true } = {
      collapsed: state.collapsed,
      width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, state.width)),
    };
    if (state.customWidth) payload.customWidth = true;
    localStorage.setItem(SECONDARY_RAIL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function insightSecondaryRailCollapsed(): boolean {
  return loadPersistedState().collapsed;
}

export function setInsightSecondaryRailCollapsed(collapsed: boolean): void {
  const state = loadPersistedState();
  state.collapsed = collapsed;
  savePersistedState(state);
}

/** @deprecated use insightSecondaryRailCollapsed */
export function insightChatRailCollapsed(): boolean {
  return insightSecondaryRailCollapsed();
}

/** @deprecated use setInsightSecondaryRailCollapsed */
export function setInsightChatRailCollapsed(collapsed: boolean): void {
  setInsightSecondaryRailCollapsed(collapsed);
}

export function createSecondaryRailController(
  opts: SecondaryRailControllerOptions,
): SecondaryRailController {
  let descriptor: RailDescriptor | null = null;
  let contentCleanup: (() => void) | null = null;
  let createHandler: (() => void) | null = null;
  let state = loadPersistedState();
  let drag: RailDragState = { phase: "idle" };
  const railInner = opts.railHost.querySelector<HTMLElement>(".insight-secondary-rail-inner")!;
  const contentHost = railInner.querySelector<HTMLElement>("[data-rail-content]")!;
  const titleEl = railInner.querySelector<HTMLElement>(".insight-chat-rail-title")!;

  function userExpanded(): boolean {
    return descriptor !== null && !state.collapsed;
  }

  function targetWidth(): number {
    if (drag.phase !== "idle") return drag.preview;
    if (state.customWidth) return state.width;
    return themeDefaultWidth();
  }

  function collapseAriaLabel(title: string, collapsed: boolean): string {
    return collapsed ? `展开${title}` : `收起${title}`;
  }

  function updateResizeAria(): void {
    const now = opts.getEffectiveWidth();
    const min = opts.getEffectiveMin();
    const max = opts.getEffectiveMax();
    opts.railResize.setAttribute("aria-valuemin", `${Math.round(min)}`);
    opts.railResize.setAttribute("aria-valuemax", `${Math.round(Math.max(min, max))}`);
    opts.railResize.setAttribute("aria-valuenow", `${Math.round(now)}`);
    opts.railResize.setAttribute("aria-valuetext", `${Math.round(now)} 像素`);
  }

  function applyChrome(): void {
    const hasDescriptor = descriptor !== null;
    const expanded = userExpanded();
    opts.railHost.hidden = !hasDescriptor;
    opts.railHost.classList.toggle("is-expanded", expanded);
    opts.railHost.classList.toggle("is-collapsed", hasDescriptor && !expanded);
    opts.toggle.hidden = !hasDescriptor;
    opts.toggle.classList.toggle("is-rail-collapsed", hasDescriptor && !expanded);
    const eff = opts.getEffectiveWidth();
    opts.railResize.hidden = !expanded || eff <= 0;
    updateResizeAria();
    updateToggleAria();
  }

  function updateToggleAria(): void {
    if (!descriptor) {
      opts.toggle.setAttribute("aria-label", "收起二级栏");
      opts.toggle.setAttribute("aria-expanded", "false");
      return;
    }
    opts.toggle.setAttribute(
      "aria-label",
      collapseAriaLabel(descriptor.title, !userExpanded()),
    );
    opts.toggle.setAttribute("aria-expanded", userExpanded() ? "true" : "false");
  }

  function clearRailContent(): void {
    contentCleanup?.();
    contentCleanup = null;
    if (createHandler) {
      railInner.querySelector<HTMLButtonElement>("[data-rail-create]")?.removeEventListener(
        "click",
        createHandler,
      );
      createHandler = null;
    }
    contentHost.innerHTML = "";
    titleEl.textContent = "";
    railInner.querySelector<HTMLButtonElement>("[data-rail-create]")?.remove();
  }

  function mountRailContent(desc: RailDescriptor): void {
    clearRailContent();
    titleEl.textContent = desc.title;

    let createBtn = railInner.querySelector<HTMLButtonElement>("[data-rail-create]");
    if (desc.onCreate) {
      if (!createBtn) {
        createBtn = document.createElement("button");
        createBtn.type = "button";
        createBtn.className = "insight-chat-rail-new";
        createBtn.dataset.railCreate = "";
        createBtn.setAttribute("aria-label", "新建");
        createBtn.textContent = "+";
        railInner.querySelector(".insight-chat-rail-bar")!.appendChild(createBtn);
      }
      createHandler = desc.onCreate;
      createBtn.addEventListener("click", createHandler);
    } else {
      createBtn?.remove();
    }

    const cleanup = desc.renderContent(contentHost);
    if (typeof cleanup === "function") contentCleanup = cleanup;
  }

  function notifyGeometry(): void {
    applyChrome();
    opts.onGeometryChange();
  }

  function setDescriptor(desc: RailDescriptor | null): void {
    descriptor = desc;
    if (desc) mountRailContent(desc);
    else clearRailContent();
    notifyGeometry();
  }

  function clampPreferred(width: number): number {
    const maxW = opts.getEffectiveMax();
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.min(maxW, width)));
  }

  function commitPreferred(width: number): void {
    state.width = clampPreferred(width);
    state.customWidth = true;
    savePersistedState(state);
    drag = { phase: "idle" };
    notifyGeometry();
  }

  function cancelDrag(): void {
    if (drag.phase === "idle") return;
    drag = { phase: "idle" };
    opts.railResize.classList.remove("is-dragging");
    notifyGeometry();
  }

  const onToggleClick = () => {
    if (!descriptor) return;
    state.collapsed = !state.collapsed;
    savePersistedState(state);
    notifyGeometry();
    window.dispatchEvent(new Event(INSIGHT_SECONDARY_RAIL_TOGGLE_EVENT));
  };

  let resizeStartX = 0;

  opts.railResize.addEventListener("pointerdown", (e) => {
    if (!userExpanded()) return;
    e.preventDefault();
    e.stopPropagation();
    const startDesired = targetWidth();
    drag = { phase: "dragging", pointerId: e.pointerId, startDesired, preview: startDesired };
    resizeStartX = e.clientX;
    opts.railResize.setPointerCapture(e.pointerId);
    opts.railResize.classList.add("is-dragging");
  });

  opts.railResize.addEventListener("pointermove", (e) => {
    if (drag.phase !== "dragging" || drag.pointerId !== e.pointerId) return;
    drag.preview = clampPreferred(drag.startDesired + (e.clientX - resizeStartX));
    opts.onGeometryChange();
  });

  const endResize = (e: PointerEvent, persist: boolean) => {
    if (drag.phase !== "dragging" || drag.pointerId !== e.pointerId) return;
    const preview = drag.preview;
    try {
      opts.railResize.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    opts.railResize.classList.remove("is-dragging");
    if (persist) commitPreferred(preview);
    else cancelDrag();
  };

  opts.railResize.addEventListener("pointerup", (e) => endResize(e, true));
  opts.railResize.addEventListener("pointercancel", (e) => endResize(e, false));

  const onKeyPreview = (e: KeyboardEvent) => {
    if (!userExpanded()) return;
    if (e.key === "Escape") {
      if (drag.phase !== "idle") {
        e.preventDefault();
        if (typeof drag.pointerId === "number") {
          try {
            opts.railResize.releasePointerCapture(drag.pointerId);
          } catch {
            /* ignore */
          }
        }
        cancelDrag();
      }
      return;
    }
    if (e.key === "Enter" && drag.phase === "dragging" && drag.pointerId === "keyboard") {
      e.preventDefault();
      commitPreferred(drag.preview);
      return;
    }
    const maxW = opts.getEffectiveMax();
    const step = e.shiftKey ? 40 : 10;
    let next = drag.phase === "idle" ? targetWidth() : drag.preview;
    let handled = false;
    switch (e.key) {
      case "ArrowLeft":
        next -= step;
        handled = true;
        break;
      case "ArrowRight":
        next += step;
        handled = true;
        break;
      case "Home":
        next = MIN_WIDTH;
        handled = true;
        break;
      case "End":
        next = maxW;
        handled = true;
        break;
      default:
        break;
    }
    if (!handled) return;
    e.preventDefault();
    const startDesired = drag.phase === "idle" ? targetWidth() : drag.startDesired;
    drag = {
      phase: "dragging",
      pointerId: "keyboard",
      startDesired,
      preview: clampPreferred(next),
    };
    opts.onGeometryChange();
  };

  opts.railResize.addEventListener("keydown", onKeyPreview);
  opts.railResize.addEventListener("blur", () => {
    if (drag.phase === "dragging" && drag.pointerId === "keyboard") {
      commitPreferred(drag.preview);
    }
  });

  const onWindowKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (drag.phase !== "dragging" || typeof drag.pointerId !== "number") return;
    try {
      opts.railResize.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    cancelDrag();
  };
  window.addEventListener("keydown", onWindowKey);

  opts.toggle.addEventListener("click", onToggleClick);
  applyChrome();

  return {
    setDescriptor,
    refreshGeometry: notifyGeometry,
    preferredWidth: targetWidth,
    isUserExpanded: userExpanded,
    syncChrome: applyChrome,
    dispose() {
      if (drag.phase !== "idle") cancelDrag();
      clearRailContent();
      opts.toggle.removeEventListener("click", onToggleClick);
      window.removeEventListener("keydown", onWindowKey);
      descriptor = null;
    },
  };
}

import { isPrivacyBlockedTarget, PRIVACY_MODE_EVT } from "../core/privacy-mode";

let tipEl: HTMLElement | null = null;
let tipText: HTMLElement | null = null;
let activeEl: Element | null = null;
let activeFollow = false;

function ensureTip() {
  if (tipEl) return;
  tipEl = document.createElement("div");
  tipEl.className = "hover-tip";
  tipEl.innerHTML = '<span class="hover-tip__text"></span>';
  document.body.appendChild(tipEl);
  tipText = tipEl.querySelector<HTMLElement>(".hover-tip__text")!;
}

function normalizeTipText(text: string) {
  return text.replace(/\\/g, "/");
}

function hideHoverTip() {
  tipEl?.classList.remove("is-visible");
  activeEl = null;
  activeFollow = false;
}

export { hideHoverTip };

function positionTip(left: number, top: number) {
  if (!tipEl) return;
  const tipRect = tipEl.getBoundingClientRect();
  if (left + tipRect.width > window.innerWidth - 12) {
    left = window.innerWidth - tipRect.width - 12;
  }
  if (top + tipRect.height > window.innerHeight - 12) {
    top = top - tipRect.height - 20;
  }
  tipEl.style.left = `${Math.max(12, left)}px`;
  tipEl.style.top = `${Math.max(12, top)}px`;
}

function showTipAt(x: number, y: number, raw: string, anchor: Element) {
  const text = normalizeTipText(raw.trim());
  if (!text) return;
  if (isPrivacyBlockedTarget(anchor)) return;
  ensureTip();
  tipText!.textContent = text;
  tipText!.classList.toggle("hover-tip__text--multiline", text.includes("\n"));
  tipEl!.classList.remove("is-visible");
  tipEl!.style.visibility = "hidden";
  tipEl!.style.left = "0";
  tipEl!.style.top = "0";
  tipEl!.getBoundingClientRect();
  tipEl!.style.visibility = "";
  positionTip(x + 12, y + 16);
  activeEl = anchor;
  activeFollow = true;
  requestAnimationFrame(() => tipEl!.classList.add("is-visible"));
}

function showTip(anchor: Element, raw: string) {
  const text = normalizeTipText(raw.trim());
  if (!text) return;
  if (isPrivacyBlockedTarget(anchor)) return;
  ensureTip();
  tipText!.textContent = text;
  tipText!.classList.toggle("hover-tip__text--multiline", text.includes("\n"));
  tipEl!.classList.remove("is-visible");
  tipEl!.style.visibility = "hidden";
  tipEl!.style.left = "0";
  tipEl!.style.top = "0";
  tipEl!.getBoundingClientRect();
  tipEl!.style.visibility = "";
  const rect = anchor.getBoundingClientRect();
  positionTip(rect.left, rect.bottom + 6);
  activeEl = anchor;
  activeFollow = false;
  requestAnimationFrame(() => tipEl!.classList.add("is-visible"));
}

function tipFollows(el: Element): boolean {
  return (el as HTMLElement).dataset?.tipFollow !== undefined;
}

function tipFrom(el: Element): string {
  const tip = (el as HTMLElement).dataset?.tip;
  if (tip) return tip;
  if (el instanceof HTMLElement && el.matches(PATH_TIP_SELECTOR) && el.dataset.path) return el.dataset.path;
  return "";
}

const PATH_TIP_SELECTOR =
  ".local-tree-leaf[data-path], .local-file-row[data-path], .local-search-hit[data-path]";

function tipTargetFrom(node: EventTarget | null): Element | null {
  if (!(node instanceof Element)) return null;
  const tipEl = node.closest("[data-tip]");
  if (tipEl && (tipEl as HTMLElement).dataset?.tip) return tipEl;
  const pathEl = node.closest(PATH_TIP_SELECTOR);
  if (pathEl instanceof HTMLElement && pathEl.dataset.path) return pathEl;
  return null;
}

export function initHoverTips() {
  window.addEventListener(PRIVACY_MODE_EVT, (e) => {
    if ((e as CustomEvent<{ on?: boolean }>).detail?.on) hideHoverTip();
  });

  document.addEventListener("mouseover", (e) => {
    const el = tipTargetFrom(e.target);
    if (!el) {
      if (activeEl) hideHoverTip();
      return;
    }
    const text = tipFrom(el);
    if (!text || el === activeEl) return;
    if (tipFollows(el)) showTipAt(e.clientX, e.clientY, text, el);
    else showTip(el, text);
  });

  document.addEventListener("mousemove", (e) => {
    if (!activeEl || !activeFollow) return;
    const text = tipFrom(activeEl);
    if (!text) return;
    positionTip(e.clientX + 12, e.clientY + 16);
  });

  document.addEventListener("mouseout", (e) => {
    if (!activeEl) return;
    const related = e.relatedTarget as Node | null;
    if (related && activeEl.contains(related)) return;
    if (tipTargetFrom(related)) return;
    hideHoverTip();
  });
}

export function bindHoverTip(
  el: Element,
  text: string,
  signal?: AbortSignal,
) {
  el.removeAttribute("title");
  (el as HTMLElement).dataset.tip = text;
  signal?.addEventListener("abort", () => {
    if (activeEl === el) hideHoverTip();
    delete (el as HTMLElement).dataset.tip;
  }, { once: true });
}

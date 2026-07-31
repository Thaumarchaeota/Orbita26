let tipEl: HTMLElement | null = null;
let tipText: HTMLElement | null = null;
let activeEl: HTMLElement | null = null;

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
}

export { hideHoverTip };

function showTip(anchor: HTMLElement, raw: string) {
  const text = normalizeTipText(raw.trim());
  if (!text) return;
  ensureTip();
  tipText!.textContent = text;
  tipEl!.classList.remove("is-visible");
  tipEl!.style.visibility = "hidden";
  tipEl!.style.left = "0";
  tipEl!.style.top = "0";
  const tipRect = tipEl!.getBoundingClientRect();
  tipEl!.style.visibility = "";
  const rect = anchor.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + tipRect.width > window.innerWidth - 12) {
    left = window.innerWidth - tipRect.width - 12;
  }
  if (top + tipRect.height > window.innerHeight - 12) {
    top = rect.top - tipRect.height - 6;
  }
  tipEl!.style.left = `${Math.max(12, left)}px`;
  tipEl!.style.top = `${Math.max(12, top)}px`;
  activeEl = anchor;
  requestAnimationFrame(() => tipEl!.classList.add("is-visible"));
}

function tipFrom(el: HTMLElement): string {
  if (el.dataset.tip) return el.dataset.tip;
  if (el.matches(PATH_TIP_SELECTOR) && el.dataset.path) return el.dataset.path;
  return "";
}

const PATH_TIP_SELECTOR =
  ".local-tree-leaf[data-path], .local-file-row[data-path], .local-search-hit[data-path]";

function tipTargetFrom(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof HTMLElement)) return null;
  const tipEl = node.closest<HTMLElement>("[data-tip]");
  if (tipEl?.dataset.tip) return tipEl;
  const pathEl = node.closest<HTMLElement>(PATH_TIP_SELECTOR);
  if (pathEl?.dataset.path) return pathEl;
  return null;
}

export function initHoverTips() {
  document.addEventListener("mouseover", (e) => {
    const el = tipTargetFrom(e.target);
    if (!el) {
      if (activeEl) hideHoverTip();
      return;
    }
    const text = tipFrom(el);
    if (!text || el === activeEl) return;
    showTip(el, text);
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
  el: HTMLElement,
  text: string,
  signal?: AbortSignal,
) {
  el.removeAttribute("title");
  el.dataset.tip = text;
  signal?.addEventListener("abort", () => {
    if (activeEl === el) hideHoverTip();
    delete el.dataset.tip;
  }, { once: true });
}

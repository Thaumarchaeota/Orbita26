const FLIP_DURATION_MS = 250;

const activeCleanups = new WeakMap<HTMLElement, () => void>();

export function prefersReducedLayoutMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function cancelLayoutFlip(target: HTMLElement): void {
  activeCleanups.get(target)?.();
}

export function runLayoutFlip(
  target: HTMLElement,
  mutate: () => void,
  options?: { axis?: "x" | "y"; durationMs?: number },
): Promise<void> {
  const axis = options?.axis ?? "x";
  const durationMs = options?.durationMs ?? FLIP_DURATION_MS;

  cancelLayoutFlip(target);

  if (prefersReducedLayoutMotion()) {
    mutate();
    return Promise.resolve();
  }

  const before = target.getBoundingClientRect();
  mutate();
  const after = target.getBoundingClientRect();
  const delta = axis === "x" ? before.left - after.left : before.top - after.top;

  if (Math.abs(delta) < 0.5) {
    return Promise.resolve();
  }

  const translate = axis === "x" ? `translateX(${delta}px)` : `translateY(${delta}px)`;
  target.style.transform = translate;
  target.style.transition = "none";
  void target.offsetWidth;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallbackTimer);
      target.removeEventListener("transitionend", onEnd);
      target.removeEventListener("transitioncancel", onCancel);
      target.style.transform = "";
      target.style.transition = "";
      activeCleanups.delete(target);
      resolve();
    };

    const onEnd = (event: TransitionEvent) => {
      if (event.target !== target || event.propertyName !== "transform") return;
      finish();
    };

    const onCancel = () => finish();

    activeCleanups.set(target, finish);

    const fallbackTimer = window.setTimeout(finish, durationMs + 80);

    requestAnimationFrame(() => {
      target.style.transition = `transform ${durationMs}ms ease`;
      target.style.transform = "";
    });

    target.addEventListener("transitionend", onEnd);
    target.addEventListener("transitioncancel", onCancel);
  });
}

export function queryLayoutFlipTarget(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-layout-flip]");
}

const PANEL_SLIDE_MS = 260;

function waitPanelTransition(el: HTMLElement, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== el) return;
      if (event.propertyName !== "transform" && event.propertyName !== "opacity") return;
      finish();
    };
    const timer = window.setTimeout(finish, durationMs + 60);
    el.addEventListener("transitionend", onEnd);
  });
}

export function clearPanelSlideStyles(el: HTMLElement): void {
  el.style.transition = "";
  el.style.transform = "";
  el.style.opacity = "";
}

export function runPanelSlide(
  el: HTMLElement,
  open: boolean,
  options?: { durationMs?: number; offset?: number },
): Promise<void> {
  const durationMs = options?.durationMs ?? PANEL_SLIDE_MS;
  const offset = options?.offset ?? 20;
  if (prefersReducedLayoutMotion()) return Promise.resolve();

  el.style.transition = `transform ${durationMs}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${durationMs - 40}ms ease`;

  if (!open) {
    el.style.transform = `translateX(${offset}px)`;
    el.style.opacity = "0";
    return waitPanelTransition(el, durationMs).finally(() => clearPanelSlideStyles(el));
  }

  el.style.transform = `translateX(${offset}px)`;
  el.style.opacity = "0";
  void el.offsetWidth;
  el.style.transform = "";
  el.style.opacity = "1";
  return waitPanelTransition(el, durationMs).finally(() => clearPanelSlideStyles(el));
}

export function runSidebarStripMotion(el: HTMLElement): Promise<void> {
  if (prefersReducedLayoutMotion()) return Promise.resolve();
  el.style.transition = "transform 0.26s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s ease";
  el.style.transform = "translateX(-10px)";
  el.style.opacity = "0.55";
  void el.offsetWidth;
  el.style.transform = "";
  el.style.opacity = "1";
  return waitPanelTransition(el, 280).finally(() => clearPanelSlideStyles(el));
}

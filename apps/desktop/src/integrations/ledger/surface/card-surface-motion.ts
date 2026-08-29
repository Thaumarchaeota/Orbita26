type PaintProp = "backgroundColor" | "outlineColor" | "borderColor" | "color";

const VISUAL_STATE_CLASSES = ["is-deleted", "is-new", "is-modified", "is-unchanged"] as const;

export function transitionPaint(
  el: HTMLElement,
  mutate: () => void,
  props: PaintProp[] = ["backgroundColor"],
): void {
  const before = new Map<PaintProp, string>();
  for (const prop of props) {
    before.set(prop, getComputedStyle(el)[prop]);
  }
  mutate();
  const changed = props.filter((prop) => getComputedStyle(el)[prop] !== before.get(prop));
  if (!changed.length) return;
  for (const prop of changed) {
    el.style[prop] = before.get(prop)!;
  }
  void el.offsetWidth;
  requestAnimationFrame(() => {
    for (const prop of changed) {
      el.style[prop] = "";
    }
  });
}

export function carryCardPaintState(prevWrap: HTMLElement | null, nextWrap: HTMLElement): void {
  const prevCard = prevWrap?.querySelector<HTMLElement>(".cds-card");
  const nextCard = nextWrap.querySelector<HTMLElement>(".cds-card");
  if (!prevCard || !nextCard || prevCard === nextCard) return;
  const fromBg = getComputedStyle(prevCard).backgroundColor;
  const fromOutline = getComputedStyle(prevCard).outlineColor;
  nextCard.style.backgroundColor = fromBg;
  nextCard.style.outlineColor = fromOutline;
  void nextCard.offsetWidth;
  requestAnimationFrame(() => {
    nextCard.style.backgroundColor = "";
    nextCard.style.outlineColor = "";
  });
}

export function primeCardVisualTransition(card: HTMLElement): void {
  const active = VISUAL_STATE_CLASSES.find(
    (name) => name !== "is-unchanged" && card.classList.contains(name),
  );
  if (!active) return;
  const targetBg = getComputedStyle(card).backgroundColor;
  card.classList.remove(active);
  const baseBg = getComputedStyle(card).backgroundColor;
  card.classList.add(active);
  if (targetBg === baseBg) return;
  card.style.backgroundColor = baseBg;
  void card.offsetWidth;
  requestAnimationFrame(() => {
    card.style.backgroundColor = "";
  });
}

export function transitionCardVisualState(
  card: HTMLElement,
  nextVisualClass: string,
  hasValidationErr: boolean,
): void {
  const prevVisual = VISUAL_STATE_CLASSES.find((name) => card.classList.contains(name));
  const prevErr = card.classList.contains("is-validation-err");
  if (prevVisual === nextVisualClass && prevErr === hasValidationErr) return;
  transitionPaint(
    card,
    () => {
      card.classList.remove(...VISUAL_STATE_CLASSES);
      card.classList.add(nextVisualClass);
      card.classList.toggle("is-validation-err", hasValidationErr);
    },
    ["backgroundColor", "outlineColor"],
  );
}

export function transitionClassPaint(
  el: HTMLElement,
  className: string,
  on: boolean,
  props: PaintProp[] = ["backgroundColor", "borderColor", "color"],
): void {
  if (el.classList.contains(className) === on) return;
  transitionPaint(el, () => el.classList.toggle(className, on), props);
}

export type CardMotionProbeResult = {
  reducedMotion: boolean;
  transitionDuration: string;
  transitionProperty: string;
  events: string[];
};

export function probeCardMotion(
  card: HTMLElement,
  mutate: () => void,
): Promise<CardMotionProbeResult> {
  const events: string[] = [];
  const onRun = () => events.push("transitionrun");
  const onEnd = (e: TransitionEvent) => {
    if (e.target === card) events.push(`transitionend:${e.propertyName}`);
  };
  card.addEventListener("transitionrun", onRun);
  card.addEventListener("transitionend", onEnd);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  mutate();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          card.removeEventListener("transitionrun", onRun);
          card.removeEventListener("transitionend", onEnd);
          const after = getComputedStyle(card);
          resolve({
            reducedMotion,
            transitionDuration: after.transitionDuration,
            transitionProperty: after.transitionProperty,
            events,
          });
        }, 600);
      });
    });
  });
}

export function mountConnectedCardVisual(
  wrap: HTMLElement,
  visual: "deleted" | "new" | "modified" | "unchanged",
  hasValidationErr: boolean,
): void {
  const card = wrap.querySelector<HTMLElement>(".cds-card");
  if (!card) return;
  const activate = () => {
    if (!wrap.isConnected) return;
    if (visual === "new") {
      transitionCardVisualState(card, "is-new", hasValidationErr);
      return;
    }
    if (visual !== "unchanged") {
      primeCardVisualTransition(card);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(activate));
}

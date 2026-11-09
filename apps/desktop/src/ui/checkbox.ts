import "./checkbox.css";

/** Default box edge. Pass `size` or set `--orbita-checkbox-size` to override. */
export const CHECKBOX_SIZE = 18;

const SPARK_COUNT = 8;

export function createCheckbox(checked = false, size = CHECKBOX_SIZE): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "orbita-checkbox";
  btn.setAttribute("role", "checkbox");
  btn.style.setProperty("--orbita-checkbox-size", `${size}px`);

  const face = document.createElement("span");
  face.className = "orbita-checkbox__face";
  face.setAttribute("aria-hidden", "true");
  for (let i = 0; i < SPARK_COUNT; i += 1) {
    const spark = document.createElement("i");
    spark.style.setProperty("--i", String(i));
    face.appendChild(spark);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
  path.setAttribute("pathLength", "1");
  svg.appendChild(path);
  face.appendChild(svg);
  btn.appendChild(face);

  setCheckbox(btn, checked);
  return btn;
}

export function setCheckbox(el: HTMLElement, checked: boolean): void {
  el.classList.toggle("is-checked", checked);
  el.setAttribute("aria-checked", String(checked));
  if (!checked) el.classList.remove("is-checking");
}

/**
 * Apply a user-initiated completion immediately. Callers own persistence and
 * must use silent setCheckbox to restore state if the write fails.
 */
export function setCheckboxWithCompletionFeedback(el: HTMLElement, completed: boolean): void {
  const wasChecked = readCheckbox(el);
  setCheckbox(el, completed);
  if (completed && !wasChecked) playCheckboxCheck(el);
}

export function readCheckbox(el: HTMLElement): boolean {
  return el.classList.contains("is-checked");
}

const checkTokens = new WeakMap<HTMLElement, number>();
let checkSerial = 0;

/** Drop the class for a frame so a second check replays the same animation. */
export function playCheckboxCheck(el: HTMLElement): void {
  const token = ++checkSerial;
  checkTokens.set(el, token);
  el.classList.remove("is-checking");
  void el.offsetWidth;
  el.classList.add("is-checking");
  const spark = el.querySelector<HTMLElement>(".orbita-checkbox__face i");
  if (!spark || getComputedStyle(spark).animationName === "none") {
    el.classList.remove("is-checking");
    return;
  }
  spark.addEventListener("animationend", (event) => {
    if (event.target !== spark || checkTokens.get(el) !== token) return;
    el.classList.remove("is-checking");
  }, { once: true });
}

import "./choice-control.css";

export type TriState = "checked" | "indeterminate" | "unchecked";

export function createTriStateMarker(options: {
  name?: string;
  state?: TriState;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "orbita-tri-state-marker";
  btn.setAttribute("role", "checkbox");
  if (options.name) btn.dataset.name = options.name;
  setTriStateMarker(btn, options.state ?? "unchecked");
  return btn;
}

export function setTriStateMarker(el: HTMLElement, state: TriState): void {
  el.classList.remove("is-checked", "is-indeterminate", "is-unchecked");
  if (state === "checked") {
    el.classList.add("is-checked");
    el.setAttribute("aria-checked", "true");
  } else if (state === "indeterminate") {
    el.classList.add("is-indeterminate");
    el.setAttribute("aria-checked", "mixed");
  } else {
    el.classList.add("is-unchecked");
    el.setAttribute("aria-checked", "false");
  }
}

export function createChoiceCheckbox(state?: TriState): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "orbita-choice-checkbox";
  btn.setAttribute("role", "checkbox");
  setTriStateMarker(btn, state ?? "unchecked");
  return btn;
}

export function createChoiceRadio(checked = false, options?: { variant?: "default" | "card" }): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "orbita-choice-radio";
  if (options?.variant === "card") btn.classList.add("orbita-choice-radio-card");
  btn.setAttribute("role", "radio");
  setChoiceRadio(btn, checked);
  return btn;
}

export function setChoiceRadio(el: HTMLElement, checked: boolean): void {
  el.classList.toggle("is-checked", checked);
  el.setAttribute("aria-checked", String(checked));
}

export function readTriStateMarker(el: HTMLElement): TriState {
  if (el.classList.contains("is-checked")) return "checked";
  if (el.classList.contains("is-indeterminate")) return "indeterminate";
  return "unchecked";
}

export type ToggleSwitchOptions = {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  role?: string;
};

export type ToggleSwitchHandle = {
  root: HTMLButtonElement;
  getChecked: () => boolean;
  setChecked: (checked: boolean) => void;
  dispose: () => void;
};

export function mountToggleSwitch(
  container: HTMLElement,
  options: ToggleSwitchOptions,
): ToggleSwitchHandle {
  let checked = options.checked ?? false;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "orbita-toggle-switch";
  btn.setAttribute("role", "switch");
  if (options.role) btn.setAttribute("data-role", options.role);
  const track = document.createElement("span");
  track.className = "orbita-toggle-switch-track";
  track.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("span");
  thumb.className = "orbita-toggle-switch-thumb";
  track.appendChild(thumb);
  btn.appendChild(track);
  container.appendChild(btn);

  const paint = () => {
    btn.classList.toggle("is-on", checked);
    btn.setAttribute("aria-checked", String(checked));
  };

  const onClick = () => {
    checked = !checked;
    paint();
    options.onChange?.(checked);
  };
  btn.addEventListener("click", onClick);
  paint();

  return {
    root: btn,
    getChecked: () => checked,
    setChecked: (next) => {
      checked = next;
      paint();
    },
    dispose: () => btn.removeEventListener("click", onClick),
  };
}

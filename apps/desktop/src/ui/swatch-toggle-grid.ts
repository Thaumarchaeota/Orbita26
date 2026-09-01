import "./swatch-toggle-grid.css";

export type SwatchToggleOption = {
  value: string;
  label: string;
  color?: string;
  stripeStyle?: string;
  iconHtml?: string;
  iconColor?: string;
};

export type SwatchToggleGridOptions = {
  options: SwatchToggleOption[];
  columns?: number;
  values: Readonly<Record<string, boolean>>;
  ariaLabel: string;
  onChange: (value: string, on: boolean) => void;
};

export type SwatchToggleGridHandle = {
  root: HTMLElement;
  setValues: (values: Readonly<Record<string, boolean>>) => void;
  dispose: () => void;
};

export function mountSwatchToggleGrid(
  container: HTMLElement,
  options: SwatchToggleGridOptions,
): SwatchToggleGridHandle {
  const cols = options.columns ?? 2;
  const grid = document.createElement("div");
  grid.className = "orbita-swatch-toggle-grid";
  grid.style.setProperty("--swatch-toggle-cols", String(cols));
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", options.ariaLabel);
  container.appendChild(grid);

  const cells = new Map<string, HTMLButtonElement>();
  let values = { ...options.values };

  const paint = () => {
    for (const [value, cell] of cells) {
      const on = values[value] !== false;
      cell.classList.toggle("is-on", on);
      cell.classList.toggle("is-off", !on);
      cell.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  for (const opt of options.options) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "orbita-swatch-toggle-cell";
    cell.dataset.value = opt.value;
    const swatch = opt.iconHtml
      ? `<span class="orbita-swatch-toggle-icon"${opt.iconColor ? ` style="color:${opt.iconColor}"` : ""}>${opt.iconHtml}</span>`
      : `<span class="orbita-swatch-toggle-stripe" style="${
          opt.stripeStyle ? `background:${opt.stripeStyle}` : opt.color ? `background:${opt.color}` : ""
        }"></span>`;
    cell.innerHTML = `${swatch}<span class="orbita-swatch-toggle-label">${opt.label}</span>`;
    cell.addEventListener("click", () => {
      const next = !(values[opt.value] !== false);
      values = { ...values, [opt.value]: next };
      paint();
      options.onChange(opt.value, next);
    });
    cells.set(opt.value, cell);
    grid.appendChild(cell);
  }
  paint();

  return {
    root: grid,
    setValues(v) {
      values = { ...v };
      paint();
    },
    dispose() {
      grid.remove();
    },
  };
}

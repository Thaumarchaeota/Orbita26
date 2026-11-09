import "./button.css";

export type ButtonAppearance = {
  width?: number;
  height?: number;
  fontSize?: number;
  iconSize?: number;
};

function setPx(button: HTMLElement, name: string, value: number | undefined): void {
  if (value == null || !Number.isFinite(value) || value <= 0) return;
  button.style.setProperty(name, `${value}px`);
}

/** Standard Insight button. The caller owns the label, disabled state, click, and any size override. */
export function createButton(label: string, appearance?: ButtonAppearance): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "orbita-button";
  button.textContent = label;
  setPx(button, "--orbita-button-width", appearance?.width);
  setPx(button, "--orbita-button-height", appearance?.height);
  setPx(button, "--orbita-button-font-size", appearance?.fontSize);
  setPx(button, "--orbita-button-icon-size", appearance?.iconSize);
  return button;
}

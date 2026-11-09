import { mountSliderField } from "./slider-field";
import { hexToOklch, maxSrgbChroma, normalizeHex, oklchToHex } from "./color-system/color";
import type { Oklch } from "./color-system/types";
import "./color-editor.css";

export type ColorEditorOptions = { label: string; value: Oklch; lightnessOnly?: boolean; onChange: (value: Oklch) => void };
export type ColorEditorHandle = { element: HTMLElement; getValue(): Oklch; setValue(value: Oklch): void; dispose(): void };

export function mountColorEditor(host: HTMLElement, options: ColorEditorOptions): ColorEditorHandle {
  const element = document.createElement("section");
  element.className = "orbita-color-editor";
  const heading = document.createElement("div"); heading.className = "orbita-color-editor__heading";
  const title = document.createElement("strong"); title.textContent = options.label;
  const swatch = document.createElement("span"); swatch.className = "orbita-color-editor__swatch";
  const hex = document.createElement("input"); hex.type = "text"; hex.setAttribute("aria-label", `${options.label} HEX`); hex.spellcheck = false;
  heading.append(title, swatch, hex); element.append(heading);
  let value = { ...options.value };
  const sliders = [
    mountSliderField({ label: `${options.label} OKLCH L (%)`, min: 0, max: 100, step: 0.1, value: value.l * 100, onChange: (v) => commit({ ...value, l: v / 100 }) }),
    mountSliderField({ label: `${options.label} OKLCH C`, min: 0, max: Math.floor((maxSrgbChroma(value.l, value.h) + 1e-10) * 10000) / 10000, step: 0.0001, value: value.c, onChange: (v) => commit({ ...value, c: v }) }),
    mountSliderField({ label: `${options.label} OKLCH h`, min: 0, max: 360, step: 0.1, value: value.h, onChange: (v) => commit({ ...value, h: v }) }),
  ];
  const labels = ["明度 L (%)", "色度 C", "色相 h"];
  const chromaStatus = document.createElement("p"); chromaStatus.className = "orbita-color-editor__chroma-status";
  chromaStatus.hidden = Boolean(options.lightnessOnly);
  sliders.forEach((slider, index) => { const row = document.createElement("label"); row.className = "orbita-color-editor__row"; row.hidden = Boolean(options.lightnessOnly && index > 0); const caption = document.createElement("span"); caption.textContent = labels[index]!; row.append(caption, slider.element); element.append(row); if (index === 1) element.append(chromaStatus); });
  hex.readOnly = Boolean(options.lightnessOnly);
  const abort = new AbortController();
  function paint(): void {
    const output = oklchToHex(options.lightnessOnly ? { ...value, c: 0 } : value);
    const maxC = Math.floor((maxSrgbChroma(value.l, value.h) + 1e-10) * 10000) / 10000;
    sliders[1]!.setBounds(0, maxC);
    hex.value = output.hex;
    swatch.style.backgroundColor = output.hex;
    swatch.title = output.mapped ? "已映射到 sRGB 色域" : output.hex;
    hex.title = options.lightnessOnly ? `灰度预览；原彩色 ${oklchToHex(value).hex}` : output.hex;
    const displayedC = Math.min(value.c, maxC);
    chromaStatus.textContent = `输入 C ${value.c.toFixed(4)} · 实际显示 C ${displayedC.toFixed(4)} · 可用上限 ${maxC.toFixed(4)}${value.c > maxC + 1e-7 ? " · 当前超出 sRGB 色域，继续编辑 C 时将限制在上限内" : ""}`;
    sliders[0]!.setValue(value.l * 100); sliders[1]!.setValue(displayedC); sliders[2]!.setValue(value.h);
  }
  function commit(next: Oklch): void {
    value = { l: Math.min(1, Math.max(0, next.l)), c: Math.min(0.5, Math.max(0, next.c)), h: ((next.h % 360) + 360) % 360 };
    paint(); options.onChange({ ...value });
  }
  hex.addEventListener("change", () => { try { commit(hexToOklch(normalizeHex(hex.value))); } catch { paint(); } }, { signal: abort.signal });
  paint(); host.append(element);
  return { element, getValue: () => ({ ...value }), setValue: (next) => { value = { ...next }; paint(); }, dispose: () => { abort.abort(); sliders.forEach((slider) => slider.dispose()); element.remove(); } };
}

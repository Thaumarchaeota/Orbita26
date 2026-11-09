import { mountToggleSwitch } from "../../../ui/choice-control";
import { mountSliderField } from "../../../ui/slider-field";
import { oklchToHex } from "../../../ui/color-system/color";
import type { UiThemeDocument, UiThemeRoleId } from "../../../ui/color-system/theme-types";

/** Explicit draft operations, not persisted links between independently editable roles. */
export function mountThemeBulkControls(host: HTMLElement, options: {
  roleIds: readonly UiThemeRoleId[];
  readDraft(): UiThemeDocument;
  onChange(colors: UiThemeDocument["colors"]): void;
}): { dispose(): void } {
  const panel = document.createElement("section");
  panel.className = "color-management-bulk-controls";
  const makeRow = (title: string, linkLabel: string) => {
    const row = document.createElement("section"); row.className = "color-management-bulk-row";
    const header = document.createElement("header");
    const heading = document.createElement("strong"); heading.textContent = title;
    const link = document.createElement("div"); link.className = "color-management-bulk-link";
    const caption = document.createElement("span"); caption.textContent = linkLabel;
    const toggleHost = document.createElement("span"); link.append(caption, toggleHost);
    header.append(heading, link);
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true; fieldset.setAttribute("aria-label", title);
    row.append(header, fieldset); panel.append(row);
    return { header, toggleHost, fieldset };
  };

  let hueLinked = false;
  const hueRow = makeRow("统一色相 H (°)", "关联主题颜色");
  const hueSwatch = document.createElement("span");
  hueSwatch.className = "color-management-bulk-hue"; hueSwatch.setAttribute("aria-hidden", "true");
  hueRow.header.insertBefore(hueSwatch, hueRow.header.lastElementChild);
  const paintHue = (h: number) => { hueSwatch.style.backgroundColor = oklchToHex({ l: 0.75, c: 0.14, h }).hex; };
  const hueSlider = mountSliderField({
    label: "统一主题色相 H (°)", min: 0, max: 360, step: 0.1,
    value: options.readDraft().colors["brand.primary"].oklch.h,
    onChange(value) {
      const h = ((value % 360) + 360) % 360;
      paintHue(h);
      if (!hueLinked) return;
      const colors = { ...options.readDraft().colors };
      for (const role of options.roleIds) colors[role] = { oklch: { ...colors[role].oklch, h } };
      options.onChange(colors);
    },
  });
  hueRow.fieldset.append(hueSlider.element); paintHue(hueSlider.getValue());
  const hueToggle = mountToggleSwitch(hueRow.toggleHost, { onChange(checked) {
    hueLinked = checked;
    hueRow.fieldset.disabled = !checked;
    if (checked) {
      const h = options.readDraft().colors["brand.primary"].oklch.h;
      hueSlider.setValue(h); paintHue(h);
    }
  } });
  hueToggle.root.setAttribute("aria-label", "关联主题颜色色相");

  const lightnessRow = makeRow("表面明度偏移 ΔL (百分点)", "关联背景表面");
  const surfaces = options.roleIds.filter((role) => role.startsWith("surface."));
  let lightnessLinked = false;
  let lightnessBaseline = new Map<UiThemeRoleId, number>();
  const lightnessSlider = mountSliderField({
    label: "背景表面明度偏移 ΔL (百分点)", min: -100, max: 100, step: 0.1, value: 0,
    onChange(value) {
      if (!lightnessLinked) return;
      const colors = { ...options.readDraft().colors };
      // Always use the captured baseline, not the previous drag event: +5 then
      // +6 means baseline +6, and returning to zero restores unclipped values.
      for (const role of surfaces) {
        const l = Math.min(1, Math.max(0, lightnessBaseline.get(role)! + value / 100));
        colors[role] = { oklch: { ...colors[role].oklch, l } };
      }
      options.onChange(colors);
    },
  });
  lightnessRow.fieldset.append(lightnessSlider.element);
  const lightnessToggle = mountToggleSwitch(lightnessRow.toggleHost, { onChange(checked) {
    lightnessLinked = checked;
    lightnessRow.fieldset.disabled = !checked;
    if (checked) {
      const draft = options.readDraft();
      lightnessBaseline = new Map(surfaces.map((role) => [role, draft.colors[role].oklch.l]));
      lightnessSlider.setValue(0);
    } else lightnessBaseline.clear();
  } });
  lightnessToggle.root.setAttribute("aria-label", "关联背景表面明度");

  const note = document.createElement("p");
  note.textContent = "开启关联后调整；关闭后逐项细调。H 保留各颜色的 L/C，C 为 0 时不显色。ΔL 只偏移背景表面，保留文字与边框，达到 0–100% 的表面会限幅。语义色、分类色不参与。";
  panel.append(note); host.append(panel);
  return { dispose() {
    hueSlider.dispose(); lightnessSlider.dispose(); hueToggle.dispose(); lightnessToggle.dispose();
    lightnessBaseline.clear(); panel.remove();
  } };
}

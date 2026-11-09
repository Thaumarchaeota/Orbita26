export function timelineTheme(element: HTMLElement) {
  if (!element.closest(".timeline-app") || !document.documentElement.hasAttribute("data-insight-theme")) return null;
  const style = getComputedStyle(element);
  const value = (name: string) => style.getPropertyValue(name).trim();
  const family = getComputedStyle(document.body).fontFamily;
  const size = value("--insight-font-role-label");
  return {
    border: value("--insight-border-subtle"),
    secondary: value("--insight-text-secondary"),
    primary: value("--insight-primary"),
    font: `${value("--insight-weight-regular")} ${size} ${family}`,
    strongFont: `${value("--insight-weight-semibold")} ${size} ${family}`,
  };
}

export function observeTimelineTheme(element: HTMLElement, repaint: () => void): () => void {
  if (!timelineTheme(element)) return () => {};
  const observer = new MutationObserver(repaint);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-insight-theme"] });
  observer.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
  return () => observer.disconnect();
}

export function timelinePrimaryHex(element: HTMLElement): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--insight-primary)";
  element.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  return channels?.length === 3
    ? `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`
    : getComputedStyle(element).getPropertyValue("--insight-primary").trim();
}

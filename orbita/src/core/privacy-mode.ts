const KEY = "orbita:privacy-mode";
export const PRIVACY_MODE_EVT = "orbita:privacy-mode";

export function isPrivacyMode(): boolean {
  return document.documentElement.classList.contains("privacy-mode");
}

export function setPrivacyMode(on: boolean) {
  document.documentElement.classList.toggle("privacy-mode", on);
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(PRIVACY_MODE_EVT, { detail: { on } }));
}

export function togglePrivacyMode() {
  setPrivacyMode(!isPrivacyMode());
}

export function initPrivacyMode() {
  try {
    if (sessionStorage.getItem(KEY) === "1") document.documentElement.classList.add("privacy-mode");
  } catch {}

  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "h") return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
    if (t instanceof HTMLElement && t.isContentEditable) return;
    e.preventDefault();
    togglePrivacyMode();
  });
}

export function isPrivacyBlockedTarget(el: Element): boolean {
  if (!isPrivacyMode()) return false;
  return !!el.closest("#todayZone, .primary-mood-mount");
}

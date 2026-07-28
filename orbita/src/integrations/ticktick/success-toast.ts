const SUCCESS_SVG = `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
  <circle class="ticktick-success-circle" cx="32" cy="32" r="28"/>
  <path class="ticktick-success-check" d="M18 33.5L27.5 43L46 22.5"/>
</svg>`;

export function mountSuccessToast(host: HTMLElement) {
  const el = document.createElement("div");
  el.className = "ticktick-success-toast";
  el.innerHTML = `<div class="ticktick-success-burst">${SUCCESS_SVG}</div>`;
  host.appendChild(el);

  let timer = 0;

  return () => {
    window.clearTimeout(timer);
    el.classList.remove("is-playing");
    void el.offsetWidth;
    el.classList.add("is-playing");
    timer = window.setTimeout(() => el.classList.remove("is-playing"), 1400);
  };
}

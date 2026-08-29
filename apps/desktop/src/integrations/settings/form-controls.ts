const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4V4z"/></svg>`;
const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function enhancePasswordField(input: HTMLInputElement) {
  if (input.closest(".password-field")) return;
  const wrap = document.createElement("div");
  wrap.className = "password-field";
  input.replaceWith(wrap);
  wrap.appendChild(input);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "password-toggle";
  btn.dataset.tip = "显示密码";
  btn.innerHTML = EYE_SVG;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.classList.toggle("is-visible", show);
    btn.innerHTML = show ? EYE_OFF_SVG : EYE_SVG;
    btn.dataset.tip = show ? "隐藏密码" : "显示密码";
  });
  wrap.appendChild(btn);
}

export function enhanceSelectShell(shell: HTMLElement) {
  const select = shell.querySelector("select");
  if (!select) return;
  if (!shell.querySelector(".settings-select-chevron")) {
    const chevron = document.createElement("span");
    chevron.className = "settings-select-chevron";
    chevron.innerHTML = CHEVRON_SVG;
    shell.appendChild(chevron);
  }
  if (select.dataset.selectEnhanced) return;
  select.dataset.selectEnhanced = "1";
  const open = () => shell.classList.add("is-open");
  const close = () => shell.classList.remove("is-open");
  select.addEventListener("mousedown", open);
  select.addEventListener("blur", close);
  select.addEventListener("change", close);
}

export function enhancePasswordFields(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement>("input[type='password']").forEach(enhancePasswordField);
}

export function enhanceSelectFields(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".settings-select").forEach(enhanceSelectShell);
}

export function enhanceSettingsFormControls(root: HTMLElement) {
  enhanceSelectFields(root);
  enhancePasswordFields(root);
}

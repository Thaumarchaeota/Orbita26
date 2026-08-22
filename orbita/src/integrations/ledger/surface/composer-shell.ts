import "./composer-shell.css";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function label(text: string): HTMLLabelElement {
  const node = el("label", "cds-composer-label");
  node.textContent = text;
  return node;
}

function field(placeholder: string): HTMLInputElement {
  const input = el("input", "cds-composer-input");
  input.type = "text";
  input.placeholder = placeholder;
  input.readOnly = true;
  input.tabIndex = -1;
  return input;
}

function formField(labelText: string, placeholder: string, extraClass = ""): HTMLElement {
  const wrap = el("div", `cds-composer-field${extraClass ? ` ${extraClass}` : ""}`);
  wrap.append(label(labelText), field(placeholder));
  return wrap;
}

/** Phase A static Composer shell; draft/submit wired in Phase C. */
export function mountComposerShell(
  container: HTMLElement,
  signal: AbortSignal,
): () => void {
  const root = el("div", "cds-composer");
  root.setAttribute("data-role", "composer-shell");

  const title = el("h2", "cds-composer-title");
  title.setAttribute("data-role", "composer-title");
  title.textContent = "记一笔";

  const modeRow = el("div", "cds-composer-mode");
  modeRow.setAttribute("data-role", "composer-mode");
  const simpleBtn = el("button", "cds-composer-mode-btn is-active");
  simpleBtn.type = "button";
  simpleBtn.textContent = "简单";
  simpleBtn.disabled = true;
  const advancedBtn = el("button", "cds-composer-mode-btn");
  advancedBtn.type = "button";
  advancedBtn.textContent = "高级";
  advancedBtn.disabled = true;
  modeRow.append(simpleBtn, advancedBtn);

  const typeRow = el("div", "cds-composer-types");
  typeRow.setAttribute("data-role", "composer-types");
  for (const [type, name] of [
    ["expense", "支出"],
    ["income", "收入"],
    ["transfer", "转账"],
  ] as const) {
    const btn = el("button", `cds-composer-type cds-composer-type-${type}`);
    btn.type = "button";
    btn.dataset.type = type;
    btn.textContent = name;
    btn.disabled = true;
    if (type === "expense") btn.classList.add("is-active");
    typeRow.appendChild(btn);
  }

  const form = el("div", "cds-composer-form");
  form.setAttribute("data-role", "composer-form");

  const amountDateRow = el("div", "cds-composer-row-split");
  amountDateRow.append(
    formField("金额", "0.00", "cds-composer-field-amount"),
    formField("日期", "2026-08-09", "cds-composer-field-date"),
  );

  form.append(
    formField("支出类型", "选择分类"),
    formField("支出账户", "选择账户"),
    amountDateRow,
    formField("简记", "简记"),
    formField("标签", "回车添加"),
  );

  const submit = el("button", "cds-composer-submit");
  submit.type = "button";
  submit.setAttribute("data-role", "composer-submit");
  submit.textContent = "记录";
  submit.disabled = true;

  root.append(title, modeRow, typeRow, form, submit);
  container.replaceChildren(root);

  const onAbort = () => container.replaceChildren();
  signal.addEventListener("abort", onAbort);

  return () => {
    signal.removeEventListener("abort", onAbort);
    container.replaceChildren();
  };
}

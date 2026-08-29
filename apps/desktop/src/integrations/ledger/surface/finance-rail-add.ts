import type { MotionTrigger } from "../../../ui/motion";

import "./finance-rail-add.css";



export type FinanceRailAddOptions = {

  onImport: (trigger?: MotionTrigger) => void;

  onAddEntry: (trigger?: MotionTrigger) => void;

};



function el<K extends keyof HTMLElementTagNameMap>(

  tag: K,

  className?: string,

): HTMLElementTagNameMap[K] {

  const node = document.createElement(tag);

  if (className) node.className = className;

  return node;

}



export function mountFinanceRailAdd(

  container: HTMLElement,

  signal: AbortSignal,

  options: FinanceRailAddOptions,

): () => void {

  const section = el("section", "finance-rail-add-section");

  section.setAttribute("data-role", "finance-rail-add");



  const head = el("div", "finance-rail-add-head");

  const title = el("h2", "finance-rail-add-title");

  title.textContent = "添加";

  head.appendChild(title);



  const root = el("div", "finance-rail-add");



  const addBtn = el("button", "finance-rail-add-btn");

  addBtn.type = "button";

  addBtn.dataset.action = "add-entry";

  addBtn.textContent = "添加";



  const importBtn = el("button", "finance-rail-add-btn");

  importBtn.type = "button";

  importBtn.dataset.action = "import-csv";

  importBtn.textContent = "批量添加";



  root.append(addBtn, importBtn);

  section.append(head, root);

  container.replaceChildren(section);



  addBtn.addEventListener("click", () => options.onAddEntry(addBtn), { signal });

  importBtn.addEventListener("click", () => options.onImport(importBtn), { signal });



  const onAbort = () => container.replaceChildren();

  signal.addEventListener("abort", onAbort);



  return () => {

    signal.removeEventListener("abort", onAbort);

    container.replaceChildren();

  };

}


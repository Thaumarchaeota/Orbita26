import { closePopover, openPopover } from "./motion";

export type MenuItemDef = {
  action: string;
  label: string;
  danger?: boolean;
  confirm?: boolean;
};

type CtxBtn = HTMLButtonElement & { dataset: { action: string } };

function bindContextMenu(menu: HTMLElement, signal: AbortSignal) {
  let opening = false;

  const close = () => {
    void closePopover(menu);
  };

  const place = (x: number, y: number) => {
    menu.style.visibility = "hidden";
    menu.style.left = "0";
    menu.style.top = "0";
    menu.classList.add("is-open");
    const rect = menu.getBoundingClientRect();
    menu.classList.remove("is-open");
    menu.style.visibility = "";
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  };

  const openAt = (x: number, y: number) => {
    void (async () => {
      opening = true;
      if (menu.classList.contains("is-open")) {
        await closePopover(menu);
      }
      place(x, y);
      await openPopover(menu, { x, y });
      opening = false;
    })();
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (opening) return;
      if (!menu.classList.contains("is-open")) return;
      if (menu.contains(e.target as Node)) return;
      close();
    },
    { signal },
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  }, { signal });
  window.addEventListener("resize", () => close(), { signal });
  signal.addEventListener("abort", () => {
    close();
    menu.remove();
  }, { once: true });

  return { openAt, close };
}

function bindDangerConfirm(btn: CtxBtn, defaultLabel: string) {
  let armed = false;
  const reset = () => {
    armed = false;
    btn.classList.remove("is-confirm");
    btn.textContent = defaultLabel;
  };
  return {
    reset,
    tryConfirm(): boolean {
      if (!armed) {
        armed = true;
        btn.classList.add("is-confirm");
        btn.textContent = "确定吗？";
        return false;
      }
      return true;
    },
  };
}

export function mountContextMenu(signal: AbortSignal) {
  const menu = document.createElement("div");
  menu.className = "local-ctx-menu motion-popover";
  document.body.appendChild(menu);
  const { openAt, close } = bindContextMenu(menu, signal);

  let items: MenuItemDef[] = [];
  let onAction: ((action: string, trigger: HTMLButtonElement) => void) | null = null;
  const confirms = new Map<string, ReturnType<typeof bindDangerConfirm>>();

  const resetConfirms = () => {
    for (const c of confirms.values()) c.reset();
  };

  const renderItems = (defs: MenuItemDef[]) => {
    menu.innerHTML = defs
      .map(
        (item) =>
          `<button type="button" class="local-ctx-item${item.danger ? " is-danger" : ""}" data-action="${item.action}">${item.label}</button>`,
      )
      .join("");
    confirms.clear();
    for (const item of defs) {
      if (!item.confirm) continue;
      const btn = menu.querySelector<CtxBtn>(`[data-action="${item.action}"]`);
      if (btn) confirms.set(item.action, bindDangerConfirm(btn, item.label));
    }
  };

  menu.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      if (!onAction) return;
      const btn = (e.target as HTMLElement).closest<CtxBtn>(".local-ctx-item");
      if (!btn?.dataset.action) return;
      const action = btn.dataset.action;
      const item = items.find((i) => i.action === action);
      if (item?.confirm) {
        const confirm = confirms.get(action);
        if (confirm && !confirm.tryConfirm()) return;
      }
      const run = onAction;
      close();
      resetConfirms();
      onAction = null;
      items = [];
      run(action, btn);
    },
    { signal },
  );

  return {
    show(
      x: number,
      y: number,
      defs: MenuItemDef[],
      handler: (action: string, trigger: HTMLButtonElement) => void,
    ) {
      resetConfirms();
      items = defs;
      onAction = handler;
      renderItems(defs);
      openAt(x, y);
    },
    close: () => {
      close();
      resetConfirms();
      onAction = null;
      items = [];
    },
  };
}

import "./floating-panel.css";

export type FloatingPanelHandle = {
  element: HTMLElement;
  content: HTMLElement;
  setTitle(title: string): void;
  setCollapsed(collapsed: boolean): void;
  isCollapsed(): boolean;
  dispose(): void;
};

export function mountFloatingPanel(options: {
  title: string;
  content: HTMLElement;
  onCloseRequest: () => void;
  initialPosition?: { x: number; y: number };
  maxHeight?: number;
  constrainFullHeight?: boolean;
}): FloatingPanelHandle {
  const panel = document.createElement("section");
  panel.className = "orbita-floating-panel";
  panel.setAttribute("aria-label", options.title);
  panel.innerHTML = `<header class="orbita-floating-panel__handle" data-drag-handle>
    <strong class="orbita-floating-panel__title"></strong>
    <div class="orbita-floating-panel__actions">
      <button type="button" data-collapse aria-label="收起编辑器" title="收起">−</button>
      <button type="button" data-close aria-label="关闭编辑器" title="关闭">×</button>
    </div>
  </header><div class="orbita-floating-panel__content"></div>`;
  const title = panel.querySelector<HTMLElement>(".orbita-floating-panel__title")!;
  const content = panel.querySelector<HTMLElement>(".orbita-floating-panel__content")!;
  const collapse = panel.querySelector<HTMLButtonElement>("[data-collapse]")!;
  const close = panel.querySelector<HTMLButtonElement>("[data-close]")!;
  title.textContent = options.title;
  content.append(options.content);
  document.body.append(panel);

  let collapsed = false;
  const clamp = () => {
    const rect = panel.getBoundingClientRect();
    const width = Math.min(rect.width || 440, Math.max(240, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(Math.max(12, rect.top), Math.max(12, window.innerHeight - (options.constrainFullHeight ? rect.height : Math.min(rect.height, 72)) - 12));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxWidth = `calc(100vw - 24px)`;
    const viewportMaxHeight = Math.max(0, window.innerHeight - 24);
    panel.style.maxHeight = options.maxHeight == null
      ? `calc(100vh - 24px)`
      : `${Math.min(options.maxHeight, viewportMaxHeight)}px`;
  };
  panel.style.left = `${options.initialPosition?.x ?? Math.max(16, window.innerWidth - 480)}px`;
  panel.style.top = `${options.initialPosition?.y ?? 88}px`;
  const abort = new AbortController();
  const { signal } = abort;
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
  const handle = panel.querySelector<HTMLElement>("[data-drag-handle]")!;
  handle.tabIndex = 0;
  handle.setAttribute("role", "toolbar");
  handle.setAttribute("aria-label", "编辑器移动手柄；方向键移动，Escape 请求关闭");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input,select,textarea,[contenteditable=true]")) return;
    const rect = panel.getBoundingClientRect();
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { signal });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
    const maxTop = Math.max(12, window.innerHeight - (options.constrainFullHeight ? rect.height : 56) - 12);
    panel.style.left = `${Math.min(maxLeft, Math.max(12, drag.left + event.clientX - drag.x))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(12, drag.top + event.clientY - drag.y))}px`;
  }, { signal });
  const endDrag = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) drag = null; };
  handle.addEventListener("pointerup", endDrag, { signal });
  handle.addEventListener("pointercancel", endDrag, { signal });
  handle.addEventListener("lostpointercapture", endDrag, { signal });
  handle.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      options.onCloseRequest();
      return;
    }
    const delta = event.shiftKey ? 32 : 8;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(12, window.innerWidth - rect.width - 12);
    const maxTop = Math.max(12, window.innerHeight - (options.constrainFullHeight ? rect.height : 56) - 12);
    panel.style.left = `${Math.min(maxLeft, Math.max(12, rect.left + move[0]))}px`;
    panel.style.top = `${Math.min(maxTop, Math.max(12, rect.top + move[1]))}px`;
  }, { signal });
  collapse.addEventListener("click", () => setCollapsed(!collapsed), { signal });
  close.addEventListener("click", options.onCloseRequest, { signal });
  window.addEventListener("resize", clamp, { signal });
  clamp();

  function setCollapsed(next: boolean): void {
    collapsed = next;
    panel.classList.toggle("is-collapsed", next);
    collapse.textContent = next ? "+" : "−";
    collapse.title = next ? "展开" : "收起";
    collapse.setAttribute("aria-label", next ? "展开编辑器" : "收起编辑器");
  }
  return {
    element: panel,
    content,
    setTitle: (value) => { title.textContent = value; panel.setAttribute("aria-label", value); },
    setCollapsed,
    isCollapsed: () => collapsed,
    dispose: () => {
      if (drag && handle.hasPointerCapture(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
      drag = null;
      abort.abort();
      panel.remove();
    },
  };
}

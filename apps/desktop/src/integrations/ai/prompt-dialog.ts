import { bindDialog, type MotionTrigger } from "../../ui/motion";

export function mountTextDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-wide">
      <div class="dialog-title" id="textDialogTitle"></div>
      <div class="dialog-field">
        <textarea id="textDialogArea" rows="6"></textarea>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("form")!;
  const titleEl = backdrop.querySelector<HTMLElement>("#textDialogTitle")!;
  const area = backdrop.querySelector<HTMLTextAreaElement>("#textDialogArea")!;
  let resolvePending: ((value: string | null) => void) | null = null;

  const close = async (value: string | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void close(area.value);
  });
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (title: string, initial = "", trigger?: MotionTrigger) =>
    new Promise<string | null>((resolve) => {
      resolvePending = resolve;
      titleEl.textContent = title;
      area.value = initial;
      void motion.open(trigger).then(() => requestAnimationFrame(() => area.focus()));
    });
}

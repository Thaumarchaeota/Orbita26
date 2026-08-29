import { bindDialog, type MotionTrigger } from "../../ui/motion";
import { mountModalBackdrop } from "../../ui/modal-root";

type ConfirmFn = (
  title: string,
  message: string,
  trigger?: MotionTrigger,
  opts?: { confirmLabel?: string; danger?: boolean },
) => Promise<boolean>;

let sharedConfirm: ConfirmFn | null = null;

function createConfirmDialog(): ConfirmFn {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <div class="dialog-panel" id="confirmDialogPanel">
      <div class="dialog-title" id="confirmDialogTitle"></div>
      <div class="dialog-message" id="confirmDialogMessage"></div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="button" class="dialog-btn dialog-btn-danger" data-action="confirm">删除</button>
      </div>
    </div>
  `;
  mountModalBackdrop(backdrop);

  const motion = bindDialog(backdrop);
  const titleEl = backdrop.querySelector<HTMLElement>("#confirmDialogTitle")!;
  const messageEl = backdrop.querySelector<HTMLElement>("#confirmDialogMessage")!;
  const confirmBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
  let resolvePending: ((value: boolean) => void) | null = null;

  const close = async (value: boolean) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(false));
  backdrop.querySelector('[data-action="confirm"]')!.addEventListener("click", () => void close(true));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(false);
  });

  return (
    title: string,
    message: string,
    trigger?: MotionTrigger,
    opts?: { confirmLabel?: string; danger?: boolean },
  ) =>
    new Promise<boolean>((resolve) => {
      if (resolvePending) {
        resolvePending(false);
        resolvePending = null;
      }
      resolvePending = resolve;
      titleEl.textContent = title;
      messageEl.textContent = message;
      confirmBtn.textContent = opts?.confirmLabel ?? "删除";
      confirmBtn.classList.toggle("dialog-btn-danger", opts?.danger !== false);
      confirmBtn.classList.toggle("dialog-btn-primary", opts?.danger === false);
      void (async () => {
        if (motion.isOpen()) await motion.close();
        await motion.open(trigger);
      })();
    });
}

export function getConfirmDialog(): ConfirmFn {
  if (!sharedConfirm) sharedConfirm = createConfirmDialog();
  return sharedConfirm;
}

type NamePromptFn = (
  title: string,
  opts?: { label?: string; initial?: string; submitLabel?: string },
  trigger?: MotionTrigger,
) => Promise<string | null>;

let sharedNamePrompt: NamePromptFn | null = null;

function createNamePromptDialog(): NamePromptFn {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="namePromptDialogForm">
      <div class="dialog-title" id="namePromptDialogTitle"></div>
      <div class="dialog-field">
        <label for="namePromptDialogInput" id="namePromptDialogLabel">名称</label>
        <input id="namePromptDialogInput" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary" id="namePromptDialogSubmit">保存</button>
      </div>
    </form>
  `;
  mountModalBackdrop(backdrop);

  const motion = bindDialog(backdrop);
  const titleEl = backdrop.querySelector<HTMLElement>("#namePromptDialogTitle")!;
  const labelEl = backdrop.querySelector<HTMLElement>("#namePromptDialogLabel")!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>("#namePromptDialogSubmit")!;
  const form = backdrop.querySelector<HTMLFormElement>("#namePromptDialogForm")!;
  const input = backdrop.querySelector<HTMLInputElement>("#namePromptDialogInput")!;
  let resolvePending: ((value: string | null) => void) | null = null;

  const close = async (value: string | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    void close(name);
  });
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (title, opts, trigger) =>
    new Promise<string | null>((resolve) => {
      if (resolvePending) {
        resolvePending(null);
        resolvePending = null;
      }
      resolvePending = resolve;
      titleEl.textContent = title;
      labelEl.textContent = opts?.label ?? "名称";
      submitBtn.textContent = opts?.submitLabel ?? "保存";
      input.value = opts?.initial ?? "";
      void motion.open(trigger).then(() => requestAnimationFrame(() => input.focus()));
    });
}

export function getNamePromptDialog(): NamePromptFn {
  if (!sharedNamePrompt) sharedNamePrompt = createNamePromptDialog();
  return sharedNamePrompt;
}

export function mountFolderRenameDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="folderRenameDialogForm">
      <div class="dialog-title">重命名文件夹</div>
      <div class="dialog-field">
        <label for="folderRenameDialogName">名称</label>
        <input id="folderRenameDialogName" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#folderRenameDialogForm")!;
  const nameInput = backdrop.querySelector<HTMLInputElement>("#folderRenameDialogName")!;
  let resolvePending: ((value: string | null) => void) | null = null;

  const close = async (value: string | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    void close(name);
  });
  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (initial: string, trigger?: MotionTrigger) =>
    new Promise<string | null>((resolve) => {
      resolvePending = resolve;
      nameInput.value = initial;
      void motion.open(trigger).then(() => requestAnimationFrame(() => nameInput.focus()));
    });
}

export function mountBookmarkDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="bookmarkDialogForm">
      <div class="dialog-title">添加书签</div>
      <div class="dialog-field">
        <label for="bookmarkDialogName">名称</label>
        <input id="bookmarkDialogName" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-field">
        <label for="bookmarkDialogUrl">网址</label>
        <input id="bookmarkDialogUrl" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">添加</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#bookmarkDialogForm")!;
  const titleEl = backdrop.querySelector<HTMLElement>(".dialog-title")!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const nameInput = backdrop.querySelector<HTMLInputElement>("#bookmarkDialogName")!;
  const urlInput = backdrop.querySelector<HTMLInputElement>("#bookmarkDialogUrl")!;

  let resolvePending: ((value: { name: string; url: string } | null) => void) | null = null;

  const close = async (value: { name: string; url: string } | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!name || !url) return;
    void close({ name, url });
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (initial?: { name: string; url: string }, trigger?: MotionTrigger) =>
    new Promise<{ name: string; url: string } | null>((resolve) => {
      resolvePending = resolve;
      const isEdit = !!initial;
      titleEl.textContent = isEdit ? "修改书签" : "添加书签";
      submitBtn.textContent = isEdit ? "保存" : "添加";
      nameInput.value = initial?.name ?? "";
      urlInput.value = initial?.url ?? "";
      void motion.open(trigger).then(() => requestAnimationFrame(() => nameInput.focus()));
    });
}

export function mountAppDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="appDialogForm">
      <div class="dialog-title">添加应用</div>
      <div class="dialog-field">
        <label for="appDialogName">名称</label>
        <input id="appDialogName" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-field">
        <label for="appDialogPath">路径</label>
        <input id="appDialogPath" type="text" readonly>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">添加</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#appDialogForm")!;
  const titleEl = backdrop.querySelector<HTMLElement>(".dialog-title")!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const nameInput = backdrop.querySelector<HTMLInputElement>("#appDialogName")!;
  const pathInput = backdrop.querySelector<HTMLInputElement>("#appDialogPath")!;

  let resolvePending: ((value: { name: string; path: string } | null) => void) | null = null;

  const close = async (value: { name: string; path: string } | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    if (!name || !path) return;
    void close({ name, path });
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (initial: { name: string; path: string }, isEdit = false, trigger?: MotionTrigger) =>
    new Promise<{ name: string; path: string } | null>((resolve) => {
      resolvePending = resolve;
      titleEl.textContent = isEdit ? "修改应用" : "添加应用";
      submitBtn.textContent = isEdit ? "保存" : "添加";
      nameInput.value = initial.name;
      pathInput.value = initial.path;
      pathInput.readOnly = !isEdit;
      void motion.open(trigger).then(() => requestAnimationFrame(() => nameInput.focus()));
    });
}

export function mountLocalEntryDialog(root: HTMLElement) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel" id="localEntryDialogForm">
      <div class="dialog-title" id="localEntryDialogTitle"></div>
      <div class="dialog-field">
        <label for="localEntryDialogName">名称</label>
        <input id="localEntryDialogName" type="text" autocomplete="off" required>
      </div>
      <div class="dialog-field" id="localEntryPathField">
        <label for="localEntryDialogPath">路径</label>
        <input id="localEntryDialogPath" type="text" readonly>
      </div>
      <div class="dialog-field" id="localEntryColorField">
        <label>图标颜色</label>
        <div class="local-color-picks" id="localEntryColorPicks">
          <button type="button" class="local-color-swatch is-default is-active" data-color="" data-tip="默认灰度"></button>
          <button type="button" class="local-color-swatch" data-color="#1565c0" style="--swatch:#1565c0" data-tip="蓝"></button>
          <button type="button" class="local-color-swatch" data-color="#2e7d32" style="--swatch:#2e7d32" data-tip="绿"></button>
          <button type="button" class="local-color-swatch" data-color="#c5a038" style="--swatch:#c5a038" data-tip="金"></button>
          <button type="button" class="local-color-swatch" data-color="#e53935" style="--swatch:#e53935" data-tip="红"></button>
          <button type="button" class="local-color-swatch" data-color="#7c3aed" style="--swatch:#7c3aed" data-tip="紫"></button>
          <input type="color" class="local-color-input" id="localEntryDialogColor" value="#888888" data-tip="自定义">
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">添加</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const titleEl = backdrop.querySelector<HTMLElement>("#localEntryDialogTitle")!;
  const form = backdrop.querySelector<HTMLFormElement>("#localEntryDialogForm")!;
  const pathField = backdrop.querySelector<HTMLElement>("#localEntryPathField")!;
  const colorField = backdrop.querySelector<HTMLElement>("#localEntryColorField")!;
  const colorPicks = backdrop.querySelector<HTMLElement>("#localEntryColorPicks")!;
  const colorInput = backdrop.querySelector<HTMLInputElement>("#localEntryDialogColor")!;
  const submitBtn = backdrop.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const nameInput = backdrop.querySelector<HTMLInputElement>("#localEntryDialogName")!;
  const pathInput = backdrop.querySelector<HTMLInputElement>("#localEntryDialogPath")!;

  let resolvePending: ((value: { name: string; path: string; color?: string } | null) => void) | null = null;
  let groupOnlyMode = false;
  let selectedColor = "";

  const setSelectedColor = (color: string) => {
    selectedColor = color;
    colorPicks.querySelectorAll<HTMLElement>(".local-color-swatch").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.color === color);
    });
    if (color && /^#[0-9a-f]{6}$/i.test(color)) colorInput.value = color;
  };

  colorPicks.addEventListener("click", (e) => {
    const swatch = (e.target as HTMLElement).closest<HTMLElement>(".local-color-swatch");
    if (swatch) {
      setSelectedColor(swatch.dataset.color ?? "");
      return;
    }
  });
  colorInput.addEventListener("input", () => {
    setSelectedColor(colorInput.value);
    colorPicks.querySelectorAll<HTMLElement>(".local-color-swatch").forEach((btn) => {
      btn.classList.remove("is-active");
    });
  });

  const close = async (value: { name: string; path: string; color?: string } | null) => {
    await motion.close();
    resolvePending?.(value);
    resolvePending = null;
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const path = pathInput.value.trim();
    if (!name || (!groupOnlyMode && !path)) return;
    void close({ name, path, ...(selectedColor ? { color: selectedColor } : {}) });
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(null));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(null);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(null);
  });

  return (
    title: string,
    initial: { name: string; path?: string; color?: string },
    trigger?: MotionTrigger,
    options?: { isEdit?: boolean; groupOnly?: boolean },
  ) =>
    new Promise<{ name: string; path: string; color?: string } | null>((resolve) => {
      resolvePending = resolve;
      const isEdit = !!options?.isEdit;
      const groupOnly = !!options?.groupOnly;
      groupOnlyMode = groupOnly;
      titleEl.textContent = title;
      submitBtn.textContent = isEdit ? "保存" : "添加";
      pathField.style.display = groupOnly ? "none" : "";
      colorField.style.display = isEdit ? "" : "none";
      nameInput.value = initial.name;
      pathInput.value = initial.path ?? "";
      pathInput.readOnly = !isEdit;
      setSelectedColor(initial.color ?? "");
      void motion.open(trigger).then(() => requestAnimationFrame(() => nameInput.focus()));
    });
}

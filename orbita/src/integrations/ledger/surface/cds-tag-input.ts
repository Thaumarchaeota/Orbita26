export type TagInputOptions = {
  chipClass?: string;
  editClass?: string;
  onChange?: () => void;
};

const DEFAULT_CHIP_CLASS = "ledger-tag-chip";
const DEFAULT_EDIT_CLASS = "ledger-tag-chip-edit";
const TAG_LEAVE_MS = 160;

export function getTagsFromBox(box: HTMLElement): string[] {
  return [...box.querySelectorAll<HTMLElement>(".ledger-tag-chip, .tag-chip")].map(
    (c) => c.textContent || "",
  );
}

export function mountTagChip(chip: HTMLElement): void {
  chip.classList.add("is-tag-entering");
  chip.addEventListener(
    "animationend",
    () => chip.classList.remove("is-tag-entering"),
    { once: true },
  );
}

export function removeTagChip(chip: HTMLElement, onDone?: () => void): void {
  if (chip.classList.contains("is-tag-leaving")) return;
  chip.classList.add("is-tag-leaving");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    chip.remove();
    onDone?.();
  };
  chip.addEventListener("animationend", finish, { once: true });
  window.setTimeout(finish, TAG_LEAVE_MS + 40);
}

export function createTagChip(text: string, options?: TagInputOptions): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = options?.chipClass ?? DEFAULT_CHIP_CLASS;
  chip.textContent = text;
  chip.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    e.preventDefault();
    editTagChip(chip, options);
  });
  mountTagChip(chip);
  return chip;
}

export function editTagChip(chip: HTMLElement, options?: TagInputOptions): void {
  const old = chip.textContent || "";
  const input = document.createElement("input");
  input.className = options?.editClass ?? DEFAULT_EDIT_CLASS;
  input.value = old;
  chip.replaceWith(input);
  input.focus();
  input.select();

  const restore = (text: string) => {
    input.replaceWith(createTagChip(text, options));
    options?.onChange?.();
  };

  const commit = () => {
    const v = input.value.trim().replace(/^#/, "");
    if (v) restore(v);
    else {
      input.remove();
      options?.onChange?.();
    }
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      restore(old);
    }
  });
}

export function setTagsInBox(
  box: HTMLElement,
  field: HTMLInputElement,
  tags: string[],
  options?: TagInputOptions,
): void {
  box.querySelectorAll(".ledger-tag-chip, .tag-chip").forEach((c) => c.remove());
  for (const t of tags) {
    const v = String(t).trim().replace(/^#/, "");
    if (v) box.insertBefore(createTagChip(v, options), field);
  }
}

export function initTagInput(
  field: HTMLInputElement,
  box: HTMLElement,
  signal?: AbortSignal,
  options?: TagInputOptions,
): void {
  const opts = signal ? { signal } : undefined;
  field.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const v = field.value.trim().replace(/^#/, "");
        if (v && !getTagsFromBox(box).includes(v)) {
          box.insertBefore(createTagChip(v, options), field);
          options?.onChange?.();
        }
        field.value = "";
      }
      if (e.key === "Backspace" && !field.value) {
        const chips = box.querySelectorAll<HTMLElement>(".ledger-tag-chip, .tag-chip");
        const last = chips[chips.length - 1];
        if (last) removeTagChip(last, () => options?.onChange?.());
      }
    },
    opts,
  );
}

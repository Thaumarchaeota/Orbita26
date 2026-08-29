import { mountSearchableSelectPopover } from "../../../ui/searchable-select-popover";
import "./tag-picker.css";

export type TagPickerOptions = {
  tags: readonly string[];
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  placeholder?: string;
};

export type TagPickerHandle = {
  setTags: (tags: readonly string[]) => void;
  setSelected: (selected: ReadonlySet<string>) => void;
  open: () => Promise<void>;
  close: () => Promise<void>;
  dispose: () => void;
  root: HTMLElement;
};

const MAX_VISIBLE_CHIPS = 3;

export function mountTagPicker(container: HTMLElement, options: TagPickerOptions): TagPickerHandle {
  let selected = new Set(options.selected);
  let tags = [...options.tags];

  container.innerHTML = `
    <div class="orbita-tag-picker">
      <button type="button" class="orbita-tag-picker-trigger">
        <span class="orbita-tag-picker-chips"></span>
        <span class="orbita-tag-picker-placeholder"></span>
      </button>
    </div>`;

  const root = container.querySelector<HTMLElement>(".orbita-tag-picker")!;
  const trigger = root.querySelector<HTMLButtonElement>(".orbita-tag-picker-trigger")!;
  const chipsEl = root.querySelector<HTMLElement>(".orbita-tag-picker-chips")!;
  const placeholderEl = root.querySelector<HTMLElement>(".orbita-tag-picker-placeholder")!;

  const popover = mountSearchableSelectPopover({
    anchor: trigger,
    options: tags.map((t) => ({ value: t, label: t })),
    selected,
    multiple: true,
    placeholder: "搜索标签",
    maxHeight: 280,
    onChange: (next) => {
      selected = next;
      options.onChange(new Set(selected));
      paintChips();
    },
  });

  const paintChips = () => {
    chipsEl.replaceChildren();
    const list = [...selected];
    placeholderEl.textContent = list.length ? "" : (options.placeholder ?? "选择标签");
    placeholderEl.hidden = list.length > 0;
    const visible = list.slice(0, MAX_VISIBLE_CHIPS);
    for (const tag of visible) {
      const chip = document.createElement("span");
      chip.className = "orbita-tag-chip";
      chip.textContent = tag;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "orbita-tag-chip-remove";
      remove.setAttribute("aria-label", `移除 ${tag}`);
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        selected.delete(tag);
        options.onChange(new Set(selected));
        popover.setSelected(selected);
        paintChips();
      });
      chip.appendChild(remove);
      chipsEl.appendChild(chip);
    }
    if (list.length > MAX_VISIBLE_CHIPS) {
      const more = document.createElement("span");
      more.className = "orbita-tag-chip-more";
      more.textContent = `+${list.length - MAX_VISIBLE_CHIPS}`;
      chipsEl.appendChild(more);
    }
  };

  trigger.addEventListener("click", () => {
    if (popover.isOpen()) void popover.close();
    else void popover.open();
  });

  paintChips();
  return {
    setTags: (next) => {
      tags = [...next];
      popover.setOptions(tags.map((t) => ({ value: t, label: t })));
    },
    setSelected: (next) => {
      selected = new Set(next);
      popover.setSelected(selected);
      paintChips();
    },
    open: () => popover.open(),
    close: () => popover.close(),
    dispose: () => {
      popover.dispose();
      root.remove();
    },
    root,
  };
}

import { MOOD_EMOJI_PRESETS } from "../../core/data/mood-emojis";
import { closePopover, isPopoverOpen, openPopover } from "../../ui/motion";

const JOURNAL_WRITE_DISABLED = "旧 Journal 写入已停用";

export function mountPrimaryMood(root: HTMLElement) {
  const mount = root.querySelector<HTMLElement>("#primaryMoodMount");
  if (!mount) return;

  mount.innerHTML = `
    <div class="primary-mood-wrap">
      <button type="button" class="primary-mood-btn" id="primaryMoodBtn">+</button>
      <div class="primary-mood-menu scroll-slim motion-popover" id="primaryMoodMenu"></div>
    </div>
  `;

  const wrap = mount.querySelector<HTMLElement>(".primary-mood-wrap")!;
  const btn = mount.querySelector<HTMLButtonElement>("#primaryMoodBtn")!;
  const menu = mount.querySelector<HTMLElement>("#primaryMoodMenu")!;
  let ignoreOutsideUntil = 0;
  let pendingEmoji = "";

  const renderMenu = () => {
    pendingEmoji = "";
    menu.innerHTML = `
      <div class="primary-mood-grid">
        ${MOOD_EMOJI_PRESETS.map((e) => `<button type="button" class="primary-mood-opt" data-emoji="${e}">${e}</button>`).join("")}
      </div>
      <button type="button" class="primary-mood-confirm" id="primaryMoodConfirm" disabled>确认</button>
      <button type="button" class="primary-mood-clear" data-action="clear">清除</button>
    `;
    const confirmBtn = menu.querySelector<HTMLButtonElement>("#primaryMoodConfirm")!;
    menu.querySelectorAll<HTMLButtonElement>(".primary-mood-opt").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        pendingEmoji = b.dataset.emoji!;
        menu.querySelectorAll(".primary-mood-opt").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        confirmBtn.disabled = false;
      });
    });
    confirmBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    confirmBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!pendingEmoji) return;
      savePrimary(pendingEmoji);
    });
    const clearBtn = menu.querySelector<HTMLButtonElement>('[data-action="clear"]')!;
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearPrimary();
    });
  };

  function loadPrimary() {
    btn.textContent = "+";
    btn.classList.remove("has-emoji");
  }

  function savePrimary(_emoji: string) {
    alert(JOURNAL_WRITE_DISABLED);
  }

  function clearPrimary() {
    alert(JOURNAL_WRITE_DISABLED);
  }

  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (isPopoverOpen(menu)) {
      await closePopover(menu);
      return;
    }
    renderMenu();
    ignoreOutsideUntil = Date.now() + 320;
    await openPopover(menu, btn);
  });

  menu.addEventListener("mousedown", (e) => e.stopPropagation());
  menu.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("mousedown", (e) => {
    if (Date.now() < ignoreOutsideUntil) return;
    const target = e.target as Node;
    if (isPopoverOpen(menu) && !wrap.contains(target)) {
      void closePopover(menu);
    }
  });

  window.addEventListener("orbita:journal-changed", () => void loadPrimary());
  void loadPrimary();
}

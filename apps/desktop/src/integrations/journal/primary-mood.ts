import { MOOD_EMOJI_PRESETS } from "../../core/data/mood-emojis";
import { getSettings } from "../../core/settings";
import { closePopover, isPopoverOpen, openPopover } from "../../ui/motion";
import { beijingToday, journalConfigured, journalDelete, journalList, journalUpsert } from "./client";

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
    confirmBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!pendingEmoji) return;
      await savePrimary(pendingEmoji);
      await closePopover(menu);
    });
    const clearBtn = menu.querySelector<HTMLButtonElement>('[data-action="clear"]')!;
    clearBtn.addEventListener("mousedown", (e) => e.stopPropagation());
    clearBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await clearPrimary();
      await closePopover(menu);
    });
  };

  async function loadPrimary() {
    if (!journalConfigured(getSettings())) {
      btn.textContent = "+";
      btn.classList.remove("has-emoji");
      return;
    }
    try {
      const { entries } = await journalList({ date: beijingToday() });
      const primary = entries.find((e) => e.kind === "mood" && e.primary === true);
      if (primary && typeof primary.data === "object" && primary.data && "emoji" in (primary.data as object)) {
        const emoji = String((primary.data as { emoji?: string }).emoji ?? "");
        btn.textContent = emoji || "+";
        btn.classList.toggle("has-emoji", !!emoji);
      } else {
        btn.textContent = "+";
        btn.classList.remove("has-emoji");
      }
    } catch {
      btn.textContent = "+";
    }
  }

  async function savePrimary(emoji: string) {
    if (!journalConfigured(getSettings())) {
      alert("请先在设置中配置数据存储位置");
      return;
    }
    try {
      const date = beijingToday();
      const { entries } = await journalList({ date });
      const existing = entries.find((e) => e.kind === "mood" && e.primary === true);
      await journalUpsert({
        id: existing?.id ?? "",
        kind: "mood",
        date,
        primary: true,
        data: { emoji, note: "" },
      });
      await loadPrimary();
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
    } catch (err) {
      alert(String(err));
    }
  }

  async function clearPrimary() {
    if (!journalConfigured(getSettings())) return;
    try {
      const date = beijingToday();
      const { entries } = await journalList({ date });
      const existing = entries.find((e) => e.kind === "mood" && e.primary === true);
      if (existing?.id) await journalDelete(existing.id);
      await loadPrimary();
      window.dispatchEvent(new CustomEvent("orbita:journal-changed"));
    } catch (err) {
      alert(String(err));
    }
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

import {
  defaultAiConfig,
  getAiConfig,
  saveAiConfig,
  type AiConfig,
  type ApiEntry,
} from "./config";
import { SETTINGS_GEAR_SVG } from "./icons";
import { bindDialog, type MotionTrigger } from "../../ui/motion";

import { escAttr, escHtml } from "../../core/html";

function renderEntryCard(entry: ApiEntry): string {
  const chips = entry.models
    .map(
      (m) =>
        `<span class="ai-model-chip" data-model="${escAttr(m)}">${escHtml(m)}<button type="button" data-action="remove-model">×</button></span>`,
    )
    .join("");
  return `
    <div class="ai-entry-card" data-id="${escAttr(entry.id)}">
      <div class="ai-entry-head">
        <input class="ai-entry-name" type="text" value="${escAttr(entry.name)}" placeholder="名称">
        <button type="button" class="dialog-btn dialog-btn-danger ai-entry-remove" data-action="remove-entry">删除</button>
      </div>
      <div class="dialog-field">
        <label>API Key</label>
        <input class="ai-entry-key" type="password" value="${escAttr(entry.apiKey)}" autocomplete="off">
      </div>
      <div class="dialog-field">
        <label>Base URL</label>
        <input class="ai-entry-url" type="text" value="${escAttr(entry.baseUrl)}" autocomplete="off">
      </div>
      <div class="dialog-field">
        <label>模型</label>
        <div class="ai-model-chips">${chips}</div>
        <input class="ai-entry-model-input" type="text" placeholder="输入模型名回车添加" autocomplete="off">
      </div>
    </div>
  `;
}

function readEntries(listEl: HTMLElement): ApiEntry[] {
  return [...listEl.querySelectorAll<HTMLElement>(".ai-entry-card")].map((card) => {
  const models = [...card.querySelectorAll<HTMLElement>(".ai-model-chip")].map(
    (chip) => chip.dataset.model ?? "",
  ).filter(Boolean);
    return {
      id: card.dataset.id!,
      name: card.querySelector<HTMLInputElement>(".ai-entry-name")!.value.trim(),
      apiKey: card.querySelector<HTMLInputElement>(".ai-entry-key")!.value.trim(),
      baseUrl: card.querySelector<HTMLInputElement>(".ai-entry-url")!.value.trim(),
      models,
    };
  });
}

export function mountAiSettingsButton(
  container: HTMLElement,
  root: HTMLElement,
  onSaved?: () => void,
) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ai-icon-btn";
  btn.title = "AI 设置";
  btn.innerHTML = SETTINGS_GEAR_SVG;
  container.appendChild(btn);

  const open = mountAiSettingsDialog(root, onSaved);
  btn.addEventListener("click", (e) => void open(e));
}

function mountAiSettingsDialog(root: HTMLElement, onSaved?: () => void) {
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `
    <form class="dialog-panel dialog-panel-wide" id="aiSettingsForm">
      <div class="dialog-title">AI 设置</div>
      <div class="dialog-scroll">
        <div class="dialog-field">
          <label for="aiDefaultPrompt">默认 Prompt</label>
          <textarea id="aiDefaultPrompt" rows="4"></textarea>
        </div>
        <div class="dialog-section-title">API</div>
        <div id="aiEntriesList"></div>
        <button type="button" class="dialog-btn" id="aiAddEntry">添加 API</button>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn" data-action="cancel">取消</button>
        <button type="submit" class="dialog-btn dialog-btn-primary">保存</button>
      </div>
    </form>
  `;
  root.appendChild(backdrop);

  const motion = bindDialog(backdrop);
  const form = backdrop.querySelector<HTMLFormElement>("#aiSettingsForm")!;
  const promptEl = backdrop.querySelector<HTMLTextAreaElement>("#aiDefaultPrompt")!;
  const listEl = backdrop.querySelector<HTMLElement>("#aiEntriesList")!;
  let resolvePending: ((value: boolean) => void) | null = null;

  function paintEntries(entries: ApiEntry[]) {
    listEl.innerHTML = entries.map(renderEntryCard).join("");
  }

  function bindEntryEvents() {
    listEl.querySelectorAll<HTMLButtonElement>('[data-action="remove-entry"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".ai-entry-card")?.remove();
      });
    });
    listEl.querySelectorAll<HTMLButtonElement>('[data-action="remove-model"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.closest(".ai-model-chip")?.remove();
      });
    });
    listEl.querySelectorAll<HTMLInputElement>(".ai-entry-model-input").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const card = input.closest(".ai-entry-card")!;
        const chips = card.querySelector<HTMLElement>(".ai-model-chips")!;
        if ([...chips.querySelectorAll(".ai-model-chip")].some((c) => c.textContent?.startsWith(name))) {
          input.value = "";
          return;
        }
        const chip = document.createElement("span");
        chip.className = "ai-model-chip";
        chip.dataset.model = name;
        chip.innerHTML = `${escHtml(name)}<button type="button" data-action="remove-model">×</button>`;
        chip.querySelector("button")!.addEventListener("click", () => chip.remove());
        chips.appendChild(chip);
        input.value = "";
      });
    });
  }

  const close = async (saved: boolean) => {
    await motion.close();
    resolvePending?.(saved);
    resolvePending = null;
  };

  backdrop.querySelector("#aiAddEntry")!.addEventListener("click", () => {
    const entry: ApiEntry = {
      id: crypto.randomUUID(),
      name: "新 API",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4o-mini"],
    };
    listEl.insertAdjacentHTML("beforeend", renderEntryCard(entry));
    bindEntryEvents();
  });

  backdrop.querySelector('[data-action="cancel"]')!.addEventListener("click", () => void close(false));
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) void close(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && motion.isOpen()) void close(false);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = getAiConfig();
    const entries = readEntries(listEl).filter((e) => e.name && e.baseUrl);
    const activeEntryId = entries.some((e) => e.id === current.activeEntryId)
      ? current.activeEntryId
      : entries[0]?.id ?? current.activeEntryId;
    const activeModel = entries
      .find((e) => e.id === activeEntryId)
      ?.models.includes(current.activeModel)
      ? current.activeModel
      : entries.find((e) => e.id === activeEntryId)?.models[0] ?? current.activeModel;
    const next: AiConfig = {
      defaultPrompt: promptEl.value,
      activeEntryId,
      activeModel,
      entries: entries.length ? entries : defaultAiConfig().entries,
    };
    await saveAiConfig(next);
    onSaved?.();
    close(true);
  });

  return (trigger?: MotionTrigger) =>
    new Promise<boolean>((resolve) => {
      resolvePending = resolve;
      const config = getAiConfig();
      promptEl.value = config.defaultPrompt;
      paintEntries(config.entries);
      bindEntryEvents();
      void motion.open(trigger);
    });
}

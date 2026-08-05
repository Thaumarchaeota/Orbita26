import { defaultAiConfig } from "../../../core/data/defaults";
import type { AiConfig, ApiEntry } from "../../../core/data/types";
import { escAttr, escHtml } from "../../../core/html";
import { enhancePasswordFields } from "../form-controls";

export const aiTabHtml = `
  <div class="settings-tab-panel" data-tab-panel="ai">
    <div class="settings-section">
      <div class="settings-section-title">默认 Prompt</div>
      <div class="dialog-field">
        <textarea id="aiDefaultPrompt" rows="4"></textarea>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">API</div>
      <div id="aiEntriesList"></div>
      <button type="button" class="dialog-btn" id="aiAddEntry">添加 API</button>
    </div>
  </div>`;

export function renderEntryCard(entry: ApiEntry): string {
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

export function readEntries(listEl: HTMLElement): ApiEntry[] {
  return [...listEl.querySelectorAll<HTMLElement>(".ai-entry-card")].map((card) => {
    const models = [...card.querySelectorAll<HTMLElement>(".ai-model-chip")]
      .map((chip) => chip.dataset.model ?? "")
      .filter(Boolean);
    return {
      id: card.dataset.id!,
      name: card.querySelector<HTMLInputElement>(".ai-entry-name")!.value.trim(),
      apiKey: card.querySelector<HTMLInputElement>(".ai-entry-key")!.value.trim(),
      baseUrl: card.querySelector<HTMLInputElement>(".ai-entry-url")!.value.trim(),
      models,
    };
  });
}

export function bindAiTab(root: HTMLElement) {
  const promptEl = root.querySelector<HTMLTextAreaElement>("#aiDefaultPrompt")!;
  const listEl = root.querySelector<HTMLElement>("#aiEntriesList")!;

  function paintEntries(entries: ApiEntry[]) {
    listEl.innerHTML = entries.map(renderEntryCard).join("");
    bindEntryEvents();
    enhancePasswordFields(listEl);
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

  root.querySelector("#aiAddEntry")!.addEventListener("click", () => {
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

  return {
    fill(config: AiConfig) {
      promptEl.value = config.defaultPrompt;
      paintEntries(config.entries);
    },
    read(saved: AiConfig): AiConfig {
      const entries = readEntries(listEl).filter((e) => e.name && e.baseUrl);
      const activeEntryId = entries.some((e) => e.id === saved.activeEntryId)
        ? saved.activeEntryId
        : entries[0]?.id ?? saved.activeEntryId;
      const activeModel = entries
        .find((e) => e.id === activeEntryId)
        ?.models.includes(saved.activeModel)
        ? saved.activeModel
        : entries.find((e) => e.id === activeEntryId)?.models[0] ?? saved.activeModel;
      return {
        defaultPrompt: promptEl.value,
        activeEntryId,
        activeModel,
        entries: entries.length ? entries : defaultAiConfig().entries,
      };
    },
  };
}

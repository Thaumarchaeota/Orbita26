import { mountDecoupledDateRangePicker, type DecoupledDateRangePickerHandle } from "../../../ui/decoupled-date-range-picker";
import { mountSimpleSelect, type SimpleSelectHandle, type SimpleSelectOption } from "../../../ui/simple-select";
import { getConfirmDialog, getNamePromptDialog } from "../../shell/dialog";
import { fetchSettings, updateSettings } from "../api/client";
import { isTransactionItem } from "../domain/detail-item";
import type { DetailFilterState } from "../domain/filter-apply";
import { isFilterActive } from "../domain/filter-apply";
import {
  deserializePresetToFilterState,
  inferDatePresetFromFilter,
  serializeFilterState,
  type FilterPreset,
  type FilterPresetDate,
} from "../domain/filter-preset";
import { getDetailItems, getLoadState, onDetailMutated } from "../state/ledger";
import { mountAccountTreeMultiPicker, type AccountTreeMultiPickerHandle } from "../ui/account-tree-multi-picker";
import { mountTagPicker, type TagPickerHandle } from "../ui/tag-picker";
import type { DetailItem, SettingsResponse } from "../types";
import { ALL_FILTERABLE_STRIPE_KINDS, type FilterableStripeKind } from "./filter-kinds";
import type { CardDetailStore } from "./types";
import "./finance-rail-filter.css";

const TYPE_OPTIONS: { kind: FilterableStripeKind; label: string }[] = [
  { kind: "expense", label: "支出" },
  { kind: "proxy-expense", label: "代支出" },
  { kind: "income", label: "收入" },
  { kind: "transfer", label: "转账" },
  { kind: "repayment", label: "还款" },
  { kind: "unknown", label: "未分类" },
  { kind: "pad", label: "Pad" },
  { kind: "balance", label: "Balance" },
];

function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

const UNDO_MS = 5000;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function isTypeFilterChecked(
  typeMode: DetailFilterState["typeMode"],
  types: ReadonlySet<FilterableStripeKind>,
  kind: FilterableStripeKind,
): boolean {
  if (typeMode === "all") return true;
  return types.has(kind);
}

export function collectTagsFromDetailItems(items: readonly DetailItem[]): string[] {
  const tags = new Set<string>();
  for (const item of items) {
    if (!isTransactionItem(item)) continue;
    const raw = (item.tags || "").trim();
    if (!raw) continue;
    for (const tag of raw.split(/\s+/)) {
      if (tag) tags.add(tag);
    }
  }
  return [...tags].sort();
}

export function applyFilterStateToStore(
  store: Pick<CardDetailStore, "dispatch">,
  state: DetailFilterState,
): void {
  store.dispatch({ type: "reset-filters" });
  store.dispatch({ type: "set-date-range", from: state.dateFrom, to: state.dateTo });
  if (state.typeMode === "selected") {
    for (const kind of ALL_FILTERABLE_STRIPE_KINDS) {
      if (!state.types.has(kind)) {
        store.dispatch({ type: "toggle-type", stripeKind: kind });
      }
    }
  }
  if (state.accounts.size) {
    store.dispatch({ type: "set-accounts", accounts: new Set(state.accounts) });
  }
  if (state.accountMode !== "or") {
    store.dispatch({ type: "set-account-mode", mode: state.accountMode });
  }
  if (state.tags.size) {
    store.dispatch({ type: "set-tags", tags: new Set(state.tags) });
  }
  if (state.tagMode !== "or") {
    store.dispatch({ type: "set-tag-mode", mode: state.tagMode });
  }
}

export function applyFilterPresetToStore(
  store: Pick<CardDetailStore, "dispatch">,
  preset: FilterPreset,
  now: Date = new Date(),
): void {
  applyFilterStateToStore(store, deserializePresetToFilterState(preset, now));
}

export { inferDatePresetFromFilter, serializeFilterState };

function mountModeToggle(
  root: HTMLElement,
  initial: "or" | "and",
  onChange: (mode: "or" | "and") => void,
): { sync: (mode: "or" | "and") => void; dispose: () => void } {
  const pill = el("span", "finance-rail-mode-pill");
  pill.setAttribute("aria-hidden", "true");
  const orBtn = el("button", "finance-rail-mode-btn");
  orBtn.type = "button";
  orBtn.dataset.mode = "or";
  orBtn.textContent = "任一";
  const andBtn = el("button", "finance-rail-mode-btn");
  andBtn.type = "button";
  andBtn.dataset.mode = "and";
  andBtn.textContent = "全部";
  root.append(pill, orBtn, andBtn);

  const paint = (mode: "or" | "and") => {
    root.dataset.active = mode;
    orBtn.classList.toggle("is-active", mode === "or");
    andBtn.classList.toggle("is-active", mode === "and");
    orBtn.setAttribute("aria-pressed", String(mode === "or"));
    andBtn.setAttribute("aria-pressed", String(mode === "and"));
  };

  const onOr = () => {
    paint("or");
    onChange("or");
  };
  const onAnd = () => {
    paint("and");
    onChange("and");
  };
  orBtn.addEventListener("click", onOr);
  andBtn.addEventListener("click", onAnd);
  paint(initial);

  return {
    sync: paint,
    dispose: () => {
      orBtn.removeEventListener("click", onOr);
      andBtn.removeEventListener("click", onAnd);
    },
  };
}

export function mountFinanceRailFilter(
  container: HTMLElement,
  store: CardDetailStore,
  signal: AbortSignal,
): () => void {
  const root = el("section", "finance-rail-filter");
  root.setAttribute("data-role", "finance-rail-filter");

  const head = el("div", "finance-rail-filter-head");
  const title = el("h2", "finance-rail-filter-title");
  title.textContent = "筛选";
  const presetMount = el("div", "finance-rail-filter-preset-mount");
  presetMount.setAttribute("data-role", "preset-mount");

  const resetBtn = el("button", "finance-rail-filter-reset");
  resetBtn.type = "button";
  resetBtn.textContent = "重置";
  resetBtn.hidden = true;
  resetBtn.setAttribute("data-role", "filter-reset");
  head.append(title, presetMount, resetBtn);

  const dateBlock = el("div", "finance-rail-filter-block");
  const dateHead = el("div", "finance-rail-filter-block-head");
  const dateLabel = el("span", "finance-rail-filter-block-label");
  dateLabel.textContent = "时间";
  dateHead.append(dateLabel);
  const dateMount = el("div", "finance-rail-filter-control-mount finance-rail-filter-date-mount");
  dateMount.setAttribute("data-role", "date-mount");
  dateBlock.append(dateHead, dateMount);

  const typeBlock = el("div", "finance-rail-filter-block");
  const typeHead = el("div", "finance-rail-filter-block-head");
  const typeLabel = el("span", "finance-rail-filter-block-label");
  typeLabel.textContent = "类型";
  const typeAllBtn = el("button", "finance-rail-filter-link-btn");
  typeAllBtn.type = "button";
  typeAllBtn.textContent = "全部";
  typeAllBtn.setAttribute("data-role", "type-all");
  typeHead.append(typeLabel, typeAllBtn);
  const typeGrid = el("div", "finance-rail-type-grid");
  typeGrid.setAttribute("role", "group");
  typeGrid.setAttribute("aria-label", "交易类型");
  const typeCells = new Map<FilterableStripeKind, HTMLButtonElement>();
  for (const opt of TYPE_OPTIONS) {
    const cell = el("button", "finance-rail-type-cell is-selected");
    cell.type = "button";
    cell.dataset.stripe = opt.kind;
    cell.dataset.stripeKind = opt.kind;
    cell.setAttribute("aria-pressed", "true");
    const stripe = el("span", "finance-rail-type-stripe");
    stripe.setAttribute("aria-hidden", "true");
    const text = el("span", "finance-rail-type-text");
    text.textContent = opt.label;
    cell.append(stripe, text);
    typeGrid.appendChild(cell);
    typeCells.set(opt.kind, cell);
  }
  typeBlock.append(typeHead, typeGrid);

  const accountBlock = el("div", "finance-rail-filter-block");
  const accountHead = el("div", "finance-rail-filter-block-head");
  const accountLabel = el("span", "finance-rail-filter-block-label");
  accountLabel.textContent = "账户";
  const accountModeRoot = el("div", "finance-rail-mode-toggle");
  accountModeRoot.setAttribute("data-role", "account-mode");
  accountHead.append(accountLabel, accountModeRoot);
  const accountMount = el("div", "finance-rail-filter-control-mount");
  accountMount.setAttribute("data-role", "account-mount");
  accountBlock.append(accountHead, accountMount);

  const tagBlock = el("div", "finance-rail-filter-block");
  const tagHead = el("div", "finance-rail-filter-block-head");
  const tagLabel = el("span", "finance-rail-filter-block-label");
  tagLabel.textContent = "标签";
  const tagModeRoot = el("div", "finance-rail-mode-toggle");
  tagModeRoot.setAttribute("data-role", "tag-mode");
  tagHead.append(tagLabel, tagModeRoot);
  const tagMount = el("div", "finance-rail-filter-control-mount");
  tagMount.setAttribute("data-role", "tag-mount");
  tagBlock.append(tagHead, tagMount);

  const toast = el("div", "finance-rail-filter-toast");
  toast.hidden = true;
  toast.setAttribute("data-role", "filter-toast");
  const toastMsg = el("span", "finance-rail-filter-toast-msg");
  const toastUndo = el("button", "finance-rail-filter-toast-undo");
  toastUndo.type = "button";
  toastUndo.textContent = "撤销";
  toast.append(toastMsg, toastUndo);

  root.append(head, dateBlock, typeBlock, accountBlock, tagBlock, toast);
  container.replaceChildren(root);

  let settings: SettingsResponse | null = null;
  const confirmDialog = getConfirmDialog();
  const namePromptDialog = getNamePromptDialog();
  let presets: FilterPreset[] = [];
  let selectedPresetId = "";
  let syncing = false;
  let syncedAccounts = new Set<string>();
  let undoTimer = 0;
  let undoSnapshot: { presets: FilterPreset[]; index: number; preset: FilterPreset } | null = null;

  const datePicker: DecoupledDateRangePickerHandle = mountDecoupledDateRangePicker({ defaultTrigger: { container: dateMount },
    onChange: (value) => {
      if (syncing) return;
      store.dispatch({ type: "set-date-range", from: value.from, to: value.to });
    },
  });

  const accountPicker: AccountTreeMultiPickerHandle = mountAccountTreeMultiPicker(accountMount, {
    selected: new Set(),
    onChange: (selected) => {
      if (syncing) return;
      syncedAccounts = new Set(selected);
      store.dispatch({ type: "set-accounts", accounts: selected });
    },
  });

  const presetPicker: SimpleSelectHandle = mountSimpleSelect(presetMount, {
    options: [],
    role: "preset-select",
    onChange: (value) => {
      void onPresetSelect(value);
    },
  });

  const tagPicker: TagPickerHandle = mountTagPicker(tagMount, {
    tags: [],
    selected: new Set(),
    onChange: (selected) => {
      if (syncing) return;
      store.dispatch({ type: "set-tags", tags: selected });
    },
  });

  const accountModeToggle = mountModeToggle(accountModeRoot, "or", (mode) => {
    if (syncing) return;
    store.dispatch({ type: "set-account-mode", mode });
  });

  const tagModeToggle = mountModeToggle(tagModeRoot, "or", (mode) => {
    if (syncing) return;
    store.dispatch({ type: "set-tag-mode", mode });
  });

  const buildPresetOptions = (): SimpleSelectOption[] => {
    const items: SimpleSelectOption[] = presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
    }));
    if (presets.length) {
      items.push({ value: "__sep__", label: "────────", disabled: true, separator: true });
    }
    items.push({ value: "__save__", label: "保存当前为…" });
    items.push({ value: "__update__", label: "更新当前", disabled: !selectedPresetId });
    items.push({ value: "__delete__", label: "删除", disabled: !selectedPresetId });
    return items;
  };

  const paintPresetSelect = () => {
    presetPicker.setPlaceholder(presets.length ? "预设…" : "预设（无）");
    presetPicker.setOptions(buildPresetOptions());
    presetPicker.setValue(selectedPresetId);
  };

  const paintTypeGrid = (filter: DetailFilterState) => {
    const allMode = filter.typeMode === "all";
    for (const [kind, cell] of typeCells) {
      const checked = isTypeFilterChecked(filter.typeMode, filter.types, kind);
      cell.classList.toggle("is-selected", allMode || checked);
      cell.classList.toggle("is-unselected", !allMode && !checked);
      cell.setAttribute("aria-pressed", String(allMode || checked));
    }
  };

  const hideToast = () => {
    window.clearTimeout(undoTimer);
    undoTimer = 0;
    undoSnapshot = null;
    toast.hidden = true;
  };

  const showUndoToast = (message: string) => {
    toastMsg.textContent = message;
    toast.hidden = false;
    window.clearTimeout(undoTimer);
    undoTimer = window.setTimeout(hideToast, UNDO_MS);
  };

  const persistPresets = async (next: FilterPreset[]) => {
    if (!settings) return;
    const payload: SettingsResponse = {
      ...settings,
      filter_presets: next,
      filter_presets_version: (settings.filter_presets_version ?? 0) + 1,
      expected_settings_revision: settings.settings_revision,
    };
    settings = await updateSettings(payload, signal);
    presets = [...(settings.filter_presets ?? [])];
    paintPresetSelect();
  };

  const syncFromStore = () => {
    const filter = store.getFilterSnapshot();
    syncing = true;
    resetBtn.hidden = !isFilterActive(filter);
    datePicker.setValue({ from: filter.dateFrom, to: filter.dateTo });
    paintTypeGrid(filter);
    if (!setsEqual(filter.accounts, syncedAccounts)) {
      accountPicker.setSelected(filter.accounts);
      syncedAccounts = new Set(filter.accounts);
    }
    accountModeToggle.sync(filter.accountMode);
    tagPicker.setSelected(filter.tags);
    tagModeToggle.sync(filter.tagMode);
    syncing = false;
  };

  const refreshTagOptions = () => {
    const tags = getLoadState() === "ready" ? collectTagsFromDetailItems(getDetailItems()) : [];
    syncing = true;
    tagPicker.setTags(tags);
    tagPicker.setSelected(store.getFilterSnapshot().tags);
    syncing = false;
  };

  const saveCurrentAsPreset = async (name: string, replaceId?: string) => {
    const filter = store.getFilterSnapshot();
    const date = inferDatePresetFromFilter(filter);
    const id = replaceId ?? crypto.randomUUID();
    const preset = serializeFilterState(filter, id, name, date);
    const next = replaceId
      ? presets.map((p) => (p.id === replaceId ? preset : p))
      : [...presets, preset];
    await persistPresets(next);
    selectedPresetId = id;
    paintPresetSelect();
  };

  const onPresetSelect = async (value: string) => {
    if (!value) return;
    if (value === "__save__") {
      const trimmed = await namePromptDialog(
        "保存筛选预设",
        { label: "预设名称", submitLabel: "保存" },
        presetMount.querySelector("button") ?? undefined,
      );
      if (!trimmed) return;
      const existing = presets.find((p) => p.name === trimmed);
      if (existing) {
        const update = await confirmDialog(
          "更新预设",
          `预设「${trimmed}」已存在，是否更新？`,
          presetMount.querySelector("button") ?? undefined,
          { confirmLabel: "更新", danger: false },
        );
        if (!update) return;
        await saveCurrentAsPreset(trimmed, existing.id);
        return;
      }
      await saveCurrentAsPreset(trimmed);
      return;
    }
    if (value === "__update__") {
      const current = presets.find((p) => p.id === selectedPresetId);
      if (!current) return;
      await saveCurrentAsPreset(current.name, current.id);
      return;
    }
    if (value === "__delete__") {
      const index = presets.findIndex((p) => p.id === selectedPresetId);
      if (index < 0) return;
      const removed = presets[index]!;
      const snapshot = { presets: [...presets], index, preset: removed };
      const next = presets.filter((p) => p.id !== selectedPresetId);
      selectedPresetId = "";
      await persistPresets(next);
      undoSnapshot = snapshot;
      showUndoToast(`已删除「${removed.name}」`);
      return;
    }
    const preset = presets.find((p) => p.id === value);
    if (!preset) return;
    selectedPresetId = preset.id;
    applyFilterPresetToStore(store, preset);
    paintPresetSelect();
  };

  const onUndoDelete = async () => {
    if (!undoSnapshot || !settings) return;
    const { presets: prev, index, preset } = undoSnapshot;
    const next = [...prev];
    next.splice(index, 0, preset);
    hideToast();
    await persistPresets(next);
    selectedPresetId = preset.id;
    paintPresetSelect();
  };

  const onTypeClick = (e: Event) => {
    if (syncing) return;
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".finance-rail-type-cell");
    const kind = cell?.dataset.stripeKind as FilterableStripeKind | undefined;
    if (!kind) return;
    store.dispatch({ type: "toggle-type", stripeKind: kind });
  };

  const onTypeAll = () => {
    if (syncing) return;
    store.dispatch({ type: "set-all-types" });
  };

  const onReset = () => {
    if (syncing) return;
    selectedPresetId = "";
    store.dispatch({ type: "reset-filters" });
    paintPresetSelect();
  };

  typeGrid.addEventListener("click", onTypeClick);
  typeAllBtn.addEventListener("click", onTypeAll);
  resetBtn.addEventListener("click", onReset);
  toastUndo.addEventListener("click", () => {
    void onUndoDelete();
  });

  const unsub = store.subscribeFilter(syncFromStore);
  const unsubLedger = onDetailMutated(refreshTagOptions);
  syncFromStore();
  refreshTagOptions();

  void fetchSettings(signal)
    .then((data) => {
      if (signal.aborted) return;
      settings = data;
      presets = [...(data.filter_presets ?? [])];
      paintPresetSelect();
    })
    .catch(() => {
      paintPresetSelect();
    });

  const onAbort = () => {
    hideToast();
    container.replaceChildren();
  };
  signal.addEventListener("abort", onAbort);

  return () => {
    signal.removeEventListener("abort", onAbort);
    hideToast();
    unsub();
    unsubLedger();
    typeGrid.removeEventListener("click", onTypeClick);
    typeAllBtn.removeEventListener("click", onTypeAll);
    resetBtn.removeEventListener("click", onReset);
    accountModeToggle.dispose();
    tagModeToggle.dispose();
    datePicker.dispose();
    presetPicker.dispose();
    accountPicker.dispose();
    tagPicker.dispose();
    container.replaceChildren();
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountComposerModal } from "./composer-modal";
import type { CardDetailSnapshot, CardDetailStore } from "./types";

const confirmMock = vi.fn();

vi.mock("../../shell/dialog", () => ({
  getConfirmDialog: () => confirmMock,
}));

vi.mock("../ui/account-select", () => ({
  mountAccountSelect: (
    container: HTMLElement,
    opts: { onChange?: () => void } = {},
  ) => {
    container.innerHTML = `<input class="mock-account-select" />`;
    const input = container.querySelector("input")!;
    input.addEventListener("change", () => opts.onChange?.());
    return {
      getValue: () => input.value,
      setValue: (v: string) => {
        input.value = v;
      },
      setGroups: () => {},
      close: async () => {},
      dispose: () => {},
      containsTarget: (target: Node | null) => container.contains(target),
      hasPendingQuery: () => false,
      isOpen: () => false,
      root: container,
    };
  },
}));

vi.mock("../../../ui/date-picker", () => ({
  mountDatePicker: (container: HTMLElement, opts: { onChange?: () => void } = {}) => {
    container.innerHTML = `<input class="mock-date-picker" />`;
    const input = container.querySelector("input")!;
    input.addEventListener("input", () => opts.onChange?.());
    return {
      getValue: () => input.value,
      setValue: (v: string) => {
        input.value = v;
      },
      dispose: () => {},
    };
  },
}));

vi.mock("../../../ui/time-picker", () => ({
  mountTimePicker: (container: HTMLElement, opts: { onChange?: () => void } = {}) => {
    container.innerHTML = `<input class="mock-time-picker" />`;
    const input = container.querySelector("input")!;
    input.addEventListener("input", () => opts.onChange?.());
    return {
      getValue: () => input.value,
      setValue: (v: string) => {
        input.value = v;
      },
      close: async () => {},
      dispose: () => {},
      root: container,
    };
  },
}));

vi.mock("../domain/account-validate", () => ({
  buildAccountIndex: () => ({
    findRecord: () => ({ currencies: ["CNY"] }),
    allNames: [],
  }),
  allowedCurrenciesForAccount: () => ["CNY"],
  intersectAllowedCurrencies: () => ["CNY"],
  simpleModeNeedsAdvanced: () => false,
  validateOpenCurrency: () => null,
}));

vi.mock("../domain/entry", () => ({
  buildPostingsFromSimple: () => [
    { account: "Expenses:Food", amount: 10, currency: "CNY" },
    { account: "Assets:Cash", amount: -10, currency: "CNY" },
  ],
}));

vi.mock("./cds-composer-advanced", () => ({
  mountCdsAdvancedComposer: () => ({
    validate: () => "请填写日期",
    getDraft: () => ({
      date: "",
      time: "",
      payee: "",
      remark: "",
      flag: "*",
      tags: [],
      type: "",
      postings: [],
    }),
    reset: () => {},
    resetForContinue: () => {},
    setDate: () => {},
  }),
}));

function makeStore(overrides: Partial<CardDetailSnapshot> = {}): CardDetailStore {
  const snapshot: CardDetailSnapshot = {
    items: [],
    loadState: "ready",
    error: null,
    filter: {
      dateFrom: "",
      dateTo: "",
      typeMode: "all",
      types: new Set(),
      accounts: new Set(),
      accountMode: "or",
      tags: new Set(),
      tagMode: "or",
    },
    savePhase: "idle",
    isDirty: false,
    validationErrors: [],
    globalValidationErrors: [],
    globalValidationError: null,
    focusRequest: null,
    balanceAudit: { loadState: "idle", error: null, accounts: [] },
    ...overrides,
  };
  return {
    getSnapshot: () => snapshot,
    getFilterSnapshot: () => snapshot.filter,
    subscribe: () => () => {},
    subscribeFilter: () => () => {},
    subscribeRendered: () => () => {},
    dispatch: vi.fn(),
    handleSave: vi.fn(),
    consumeMergeFocus: () => "",
    dispose: vi.fn(),
  };
}

function queryAction(action: string): HTMLButtonElement {
  const btn = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  if (!btn) throw new Error(`missing ${action}`);
  return btn;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.getElementById("orbita-modal-root")?.remove();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
});

describe("composer-modal", () => {
  it("blocks close when dirty and confirms abandon", async () => {
    const ac = new AbortController();
    const modal = mountComposerModal(ac, makeStore());
    await modal.open();

    const amount = document.querySelector<HTMLInputElement>(".cds-composer-field-amount input")!;
    amount.value = "12";
    amount.dispatchEvent(new Event("input", { bubbles: true }));

    queryAction("cancel").click();
    await Promise.resolve();
    expect(confirmMock).toHaveBeenCalledWith(
      "放弃编辑？",
      "有未保存的内容，确定要放弃吗？",
      expect.any(HTMLElement),
      { confirmLabel: "放弃", danger: true },
    );
    modal.dispose();
  });

  it("save dispatches create-transaction and closes modal", async () => {
    const ac = new AbortController();
    const store = makeStore();
    const modal = mountComposerModal(ac, store);
    await modal.open();

    const date = document.querySelector<HTMLInputElement>(".mock-date-picker")!;
    date.value = "2026-08-09";
    const amount = document.querySelector<HTMLInputElement>(".cds-composer-field-amount input")!;
    amount.value = "10";
    const [category, account] = document.querySelectorAll<HTMLInputElement>(".mock-account-select");
    category!.value = "Expenses:Food";
    account!.value = "Assets:Cash";

    queryAction("save").click();
    await vi.waitFor(() => {
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "create-transaction" }),
      );
    });
    await vi.waitFor(() => {
      expect(document.querySelector(".dialog-backdrop.is-open")).toBeNull();
    });
    modal.dispose();
  });

  it("save-continue dispatches and keeps modal open", async () => {
    const ac = new AbortController();
    const store = makeStore();
    const modal = mountComposerModal(ac, store);
    await modal.open();

    const date = document.querySelector<HTMLInputElement>(".mock-date-picker")!;
    date.value = "2026-08-09";
    const amount = document.querySelector<HTMLInputElement>(".cds-composer-field-amount input")!;
    amount.value = "10";
    const remark = document.querySelector<HTMLInputElement>(".cds-composer-input[maxlength='50']")!;
    remark.value = "lunch";
    const [category, account] = document.querySelectorAll<HTMLInputElement>(".mock-account-select");
    category!.value = "Expenses:Food";
    account!.value = "Assets:Cash";

    queryAction("save-continue").click();
    await vi.waitFor(() => {
      expect(store.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "create-transaction" }),
      );
    });
    expect(document.querySelector(".dialog-backdrop.is-open")).not.toBeNull();
    expect(amount.value).toBe("");
    expect(remark.value).toBe("");
    expect(date.value).toBe("2026-08-09");
    expect(category.value).toBe("Expenses:Food");
    expect(account.value).toBe("Assets:Cash");
    modal.dispose();
  });
});

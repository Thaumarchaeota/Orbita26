import { beforeEach, describe, expect, it } from "vitest";
import { mountAccountSelect } from "./account-select";
import { setAccounts } from "../state/accounts";

const record = (name: string, label: string, id = name) => ({
  name,
  label,
  label_path: label.split(":").map((part) => part.trim()),
  brief: "",
  open_date: "",
  extra: "",
  id,
  source_file: "a.bean",
  source_line: 1,
});

function seedAccounts() {
  setAccounts({
    assets: [
      record("Assets:Cash", "资产:现金"),
      record("Assets:Bank:Checking", "资产:银行:活期"),
      record("Assets:Bank:Savings", "资产:银行:定期"),
    ],
    liabilities: [record("Liabilities:Card", "负债:信用卡")],
    equity: [record("Equity:Opening", "权益:期初")],
    expenses: [record("Expenses:Food", "支出:餐饮")],
    income: [record("Income:Salary", "收入:工资")],
  });
}

function open(host: HTMLElement) {
  host.querySelector<HTMLElement>(".orbita-account-select-trigger")!.click();
}

describe("AccountSelect", () => {
  beforeEach(() => { document.body.replaceChildren(); seedAccounts(); });

  it("starts a single-root menu below the root rather than rendering an extra root column", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets"] });
    open(host);
    expect(document.querySelectorAll(".orbita-account-select-column")).toHaveLength(1);
    expect(document.querySelector(".orbita-account-select-nav")?.textContent).toContain("Bank");
    expect(document.querySelector(".orbita-account-select-option")?.textContent).toContain("现金");
    expect(document.querySelector(".orbita-account-select-nav")?.textContent).not.toContain("Assets:Assets");
  });

  it("starts a wide menu at the five roots, including Equity", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets", "liabilities", "equity", "income", "expenses"] });
    open(host);
    const roots = [...document.querySelectorAll<HTMLButtonElement>(".orbita-account-select-nav")].map((item) => item.dataset.navId);
    expect(roots).toEqual(expect.arrayContaining(["Assets", "Liabilities", "Equity", "Income", "Expenses"]));
  });

  it("opens an adjacent column on hover and only commits leaf open accounts", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let value = "";
    mountAccountSelect(host, { groups: ["assets"], onChange: (next) => { value = next; } });
    open(host);
    const bank = [...document.querySelectorAll<HTMLButtonElement>(".orbita-account-select-nav")]
      .find((item) => item.dataset.navId === "Assets:Bank")!;
    bank.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(document.querySelectorAll(".orbita-account-select-column")).toHaveLength(2);
    expect(document.querySelectorAll(".orbita-account-select-option")).toHaveLength(3);
    const columns = [...document.querySelectorAll<HTMLElement>(".orbita-account-select-column")];
    expect(columns[1]!.getBoundingClientRect().left).toBeGreaterThanOrEqual(columns[0]!.getBoundingClientRect().right - 1);
    const checking = document.querySelector<HTMLButtonElement>("[data-name='Assets:Bank:Checking']")!;
    checking.click();
    expect(value).toBe("Assets:Bank:Checking");
  });

  it("searches the friendly path and bean path in a single result column", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets"] });
    open(host);
    const search = document.querySelector<HTMLInputElement>(".orbita-account-select-search")!;
    search.value = "checking";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll(".orbita-account-select-column")).toHaveLength(1);
    expect(document.querySelectorAll(".orbita-account-select-option")).toHaveLength(1);
    expect(document.querySelector(".orbita-account-select-option")?.textContent).toContain("资产 › 银行 › 活期");
    search.value = "餐饮";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll(".orbita-account-select-option")).toHaveLength(0);
  });

  it("does not offer a declared parent with children, but keeps it visible as a historical value", () => {
    setAccounts({
      assets: [record("Assets:Bank", "资产:银行"), record("Assets:Bank:Checking", "资产:银行:活期")],
      liabilities: [], equity: [], expenses: [], income: [],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountAccountSelect(host, { groups: ["assets"], value: "Assets:Bank" });
    expect(host.querySelector(".orbita-account-select-label")?.textContent).toBe("资产 › 银行");
    open(host);
    expect(document.querySelector("[data-name='Assets:Bank']")).toBeNull();
    expect(document.querySelector("[data-nav-id='Assets:Bank']")).not.toBeNull();
    handle.setGroups(["assets"]);
    expect(handle.getValue()).toBe("Assets:Bank");
  });

  it("uses bean-only stable trigger text for administrator posting editors", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountAccountSelect(host, { groups: ["assets"], value: "Assets:Bank:Checking", displayMode: "admin" });
    expect(host.querySelector(".orbita-account-select-label")?.textContent).toBe("Assets:Bank:Checking");
    expect(host.querySelector<HTMLElement>(".orbita-account-select-sub")?.hidden).toBe(true);
    open(host);
    handle.setValue("Assets:Cash");
    expect(host.querySelector(".orbita-account-select-label")?.textContent).toBe("Assets:Cash");
    expect(host.querySelector<HTMLElement>(".orbita-account-select-sub")?.hidden).toBe(true);
  });

  it("keeps column scroll position when opening a deeper branch", () => {
    setAccounts({
      assets: [
        record("Assets:Bank", "资产:银行"),
        ...Array.from({ length: 20 }, (_, index) => record(`Assets:Pad${index}`, `资产:填充${index}`)),
        record("Assets:Bank:Checking", "资产:银行:活期"),
      ],
      liabilities: [],
      equity: [],
      expenses: [],
      income: [],
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets"] });
    open(host);
    const column = document.querySelector<HTMLElement>(".orbita-account-select-column")!;
    column.scrollTop = 480;
    const bank = [...column.querySelectorAll<HTMLButtonElement>(".orbita-account-select-nav")]
      .find((item) => item.dataset.navId === "Assets:Bank")!;
    bank.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(column.scrollTop).toBe(480);
    expect(document.querySelectorAll(".orbita-account-select-column")).toHaveLength(2);
  });

  it("uses trigger combobox search without a separate menu search bar", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets"], searchPlacement: "trigger", displayMode: "admin" });
    open(host);
    expect(document.querySelector(".orbita-account-select-search-wrap")).toBeNull();
    const triggerSearch = host.querySelector<HTMLInputElement>(".orbita-account-select-trigger-search")!;
    expect(triggerSearch.hidden).toBe(false);
    triggerSearch.value = "cash";
    triggerSearch.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll(".orbita-account-select-option")).toHaveLength(1);
    expect(document.querySelector(".orbita-account-select-cascade-host")).toBeNull();
    triggerSearch.value = "";
    triggerSearch.dispatchEvent(new Event("input"));
    expect(document.querySelector(".orbita-account-select-cascade-host")).toBeTruthy();
  });

  it("dismisses without changing committed value when menu closes without selection", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    let dismissed = false;
    const handle = mountAccountSelect(host, {
      groups: ["assets"],
      value: "Assets:Cash",
      searchPlacement: "trigger",
      onDismiss: () => { dismissed = true; },
    });
    open(host);
    host.querySelector<HTMLInputElement>(".orbita-account-select-trigger-search")!.value = "bank";
    host.querySelector<HTMLInputElement>(".orbita-account-select-trigger-search")!.dispatchEvent(new Event("input"));
    void handle.close();
    expect(dismissed).toBe(true);
    expect(handle.getValue()).toBe("Assets:Cash");
  });

  it("escapes malicious labels", () => {
    setAccounts({ assets: [record("Assets:Evil", '<img onerror="window.__xss=1">')], liabilities: [], equity: [], expenses: [], income: [] });
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountAccountSelect(host, { groups: ["assets"] });
    open(host);
    expect(document.querySelector("img")).toBeNull();
  });
});

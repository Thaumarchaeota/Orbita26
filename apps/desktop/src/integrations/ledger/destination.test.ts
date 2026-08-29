import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../core/data/client", () => ({ isTauri: () => true }));
vi.mock("../../core/settings", () => ({ getSettings: () => ({ dataDir: "" }) }));
vi.mock("../shell/dialog", () => ({ getConfirmDialog: () => vi.fn() }));
vi.mock("./api/client", () => ({
  checkHealth: vi.fn(async () => false),
  fetchAccounts: vi.fn(),
  fetchSettings: vi.fn(),
  fetchLedgerHealth: vi.fn(async () => null),
  isLedgerParserCurrent: vi.fn(),
  LedgerConnectError: class LedgerConnectError extends Error {},
  resetLedgerApiBase: vi.fn(),
}));
vi.mock("./ui/card-stripe-tokens", () => ({ syncFinanceCardStripes: vi.fn() }));
vi.mock("./shell", () => ({ mountLedgerShell: vi.fn() }));
vi.mock("./state/accounts", () => ({ setAccounts: vi.fn() }));
vi.mock("./state/categories", () => ({ loadCategoriesFromAccounts: vi.fn() }));
vi.mock("./state/ledger", () => ({
  invalidateLedgerLoads: vi.fn(),
  isLedgerDirty: () => false,
  loadDetail: vi.fn(),
  loadSettings: vi.fn(),
}));
vi.mock("./views/dashboard", () => ({ mountDashboardView: vi.fn() }));
vi.mock("./views/detail", () => ({ mountDetailView: vi.fn() }));
vi.mock("./views/stats", () => ({ mountStatsView: vi.fn() }));
vi.mock("./views/structure-manager", () => ({ mountStructureManagerView: vi.fn() }));

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Finance destination retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("renders an actionable error when restarting the sidecar fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Python 环境不可用"));
    const { mountLedgerDestination } = await import("./destination");
    const panel = document.createElement("div");
    const handle = mountLedgerDestination(panel, { generation: 0, dataDirKey: "_default" });

    handle.activate();
    await vi.waitFor(() => {
      expect(panel.querySelector<HTMLButtonElement>("#ledger-retry")).not.toBeNull();
    });
    panel.querySelector<HTMLButtonElement>("#ledger-retry")!.click();
    await flush();

    expect(invokeMock).toHaveBeenCalledWith("restart_ledger_sidecar");
    expect(panel.textContent).toContain("无法连接财务服务");
    expect(panel.textContent).toContain("重启财务服务失败：Python 环境不可用");
    expect(panel.querySelector<HTMLButtonElement>("#ledger-retry")).not.toBeNull();
  });
});

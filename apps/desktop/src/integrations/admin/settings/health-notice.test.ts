import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettings = vi.hoisted(() =>
  vi.fn(() => ({
    integrations: { garmin: { syncDays: 7, tokenDir: "" }, credentials: { garmin: { email: "", password: "" } } },
    ui: {
      lifeRingGoals: {},
      healthTrackAxis: {
        mode: "fixed",
        ranges: {
          hr: { min: 40, max: 210 },
          respiration: { min: 8, max: 30 },
          steps_cumulative: { min: 0, max: 20000 },
          stress: { min: 0, max: 100 },
          body_battery: { min: 0, max: 100 },
        },
      },
    },
  })),
);
const patchSettings = vi.hoisted(() => vi.fn(async () => undefined));
const subscribeGarminSyncing = vi.hoisted(() => vi.fn(() => vi.fn()));
const garminStatus = vi.hoisted(() => vi.fn(async () => ({ loggedIn: false, rateLimited: false })));
const confirmDialog = vi.hoisted(() => vi.fn(async () => true));
const bindOptions = vi.hoisted(() => ({ current: undefined as any }));
const disposeButton = vi.hoisted(() => vi.fn());

vi.mock("../../../core/settings", () => ({ getSettings, patchSettings }));
vi.mock("../../shell/adapter", () => ({ pickLocalFolder: vi.fn(async () => null) }));
vi.mock("../../shell/dialog", () => ({ getConfirmDialog: () => confirmDialog }));
vi.mock("../../journal/client", () => ({
  formatGarminLoginError: (_reason: string, message?: string) => message ?? "登录失败",
  garminLogin: vi.fn(),
  garminStatus,
  isGarminSyncing: vi.fn(() => false),
  subscribeGarminSyncing,
}));
vi.mock("../../journal/garmin-sync-button", () => ({
  garminSyncButtonMarkup: () => '<button id="insight-garmin-sync-btn" type="button"></button>',
  bindGarminSyncButton: vi.fn((_button: HTMLButtonElement, opts: unknown) => {
    bindOptions.current = opts;
    return disposeButton;
  }),
}));

describe("Insight health sync notices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bindOptions.current = undefined;
    document.body.innerHTML = "";
    garminStatus.mockResolvedValue({ loggedIn: false, rateLimited: false });
    subscribeGarminSyncing.mockReturnValue(vi.fn());
  });

async function setup() {
    const { bindHealthTab, healthTabHtml } = await import("./health-tab");
    const root = document.createElement("div");
    root.innerHTML = healthTabHtml;
    const handle = bindHealthTab(root);
    return { root, handle, options: bindOptions.current };
  }

  async function flushPromises(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  }

  it("keeps the success counts in the sync status and broadcasts the journal refresh", async () => {
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const { root, options } = await setup();

    await options.onSuccess({ ok: true, dailyCount: 2, routineCount: 3, exerciseCount: 4 });

    expect(root.querySelector("#insight-garmin-sync-status")?.textContent).toBe("完成：daily 2，睡眠 3，活动 4");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "orbita:journal-changed" }));
  });

  it("shows sync failures through an info dialog while retaining the inline syncStatus", async () => {
    const { root, options } = await setup();

    await options.onError("同步失败：网络不可用");

    expect(root.querySelector("#insight-garmin-sync-status")?.textContent).toBe("同步失败：网络不可用");
    expect(confirmDialog).toHaveBeenCalledWith("佳明同步失败", "同步失败：网络不可用", expect.any(HTMLElement), {
      confirmLabel: "确定",
      danger: false,
      info: true,
    });
  });

  it("disposes the sync button and busy subscription together", async () => {
    const { handle } = await setup();

    handle.dispose();

    expect(disposeButton).toHaveBeenCalledTimes(1);
    expect(subscribeGarminSyncing).toHaveBeenCalledTimes(1);
    expect(subscribeGarminSyncing.mock.results[0]?.value).toHaveBeenCalledTimes(1);
  });

  it("does not write a late Garmin status result after the page is disposed", async () => {
    let resolveStatus!: (value: { loggedIn: boolean; rateLimited: boolean }) => void;
    garminStatus.mockReturnValue(new Promise((resolve) => (resolveStatus = resolve)));
    const { root, handle } = await setup();
    handle.fill(getSettings());
    const status = root.querySelector<HTMLElement>("#insight-garmin-login-status")!;
    const before = status.textContent;

    handle.dispose();
    resolveStatus({ loggedIn: true, rateLimited: false });
    await Promise.resolve();
    await Promise.resolve();

    expect(status.textContent).toBe(before);
  });

  it("does not continue a login confirmation after the page is disposed", async () => {
    const { root, handle } = await setup();
    root.querySelector<HTMLInputElement>("#insight-garmin-email")!.value = "a@example.com";
    root.querySelector<HTMLInputElement>("#insight-garmin-password")!.value = "secret";
    let releaseConfirm!: (value: boolean) => void;
    confirmDialog.mockReturnValueOnce(new Promise<boolean>((resolve) => (releaseConfirm = resolve)));

    root.querySelector<HTMLButtonElement>("#insight-garmin-login-btn")!.click();
    await flushPromises();
    handle.dispose();
    releaseConfirm(true);
    await flushPromises();

    const { garminLogin } = await import("../../journal/client");
    expect(garminLogin).not.toHaveBeenCalled();
    expect(root.querySelector("#insight-garmin-login-status")?.textContent).toBe("佳明状态：--");
  });

  it("does not write login state after disposal while Garmin login is pending", async () => {
    const { root, handle } = await setup();
    root.querySelector<HTMLInputElement>("#insight-garmin-email")!.value = "a@example.com";
    root.querySelector<HTMLInputElement>("#insight-garmin-password")!.value = "secret";
    let releaseLogin!: (value: unknown) => void;
    const { garminLogin } = await import("../../journal/client");
    garminLogin.mockReturnValue(new Promise((resolve) => (releaseLogin = resolve)));

    root.querySelector<HTMLButtonElement>("#insight-garmin-login-btn")!.click();
    await flushPromises();
    handle.dispose();
    releaseLogin({ ok: true });
    await flushPromises();

    expect(root.querySelector("#insight-garmin-login-status")?.textContent).toBe("佳明状态：登录中…");
    expect(root.querySelector("#insight-garmin-sync-status")?.textContent).toBe("");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InsightDestination, InsightDestinationId } from "./types";

vi.mock("./settings", () => ({
  mountAdminSettingsButton: () => {},
}));

vi.mock("../../core/settings", () => ({
  getSettings: () => ({ dataDir: "", ui: { insightTheme: "cold" } }),
}));

vi.mock("../productivity/client", () => ({
  productivityListProjects: vi.fn(() => Promise.resolve({ projects: [] })),
  productivityListLists: vi.fn(() => Promise.resolve({ lists: [] })),
}));

vi.mock("../shell/dialog", () => ({
  getConfirmDialog: () => async () => true,
  getNamePromptDialog: () => async () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

function destination(id: InsightDestinationId): InsightDestination {
  return {
    id,
    kind: "domain",
    label: id,
    icon: id,
    mount: () => ({
      activate: () => {},
      deactivate: () => {},
      dispose: () => {},
    }),
  };
}

async function mountWithLegacyDestinations(): Promise<HTMLElement> {
  const { registerInsightDestination } = await import("./registry");
  const { mountAdminShell } = await import("./shell");
  // These destinations represent retained route/session data; the shell must not
  // turn them into additional sidebar entries.
  for (const id of ["home", "health", "journal", "finance", "work", "timeline", "settings"] as const) {
    registerInsightDestination(destination(id));
  }
  const root = document.createElement("div");
  document.body.appendChild(root);
  mountAdminShell(root);
  await Promise.resolve();
  await Promise.resolve();
  return root;
}

describe("Insight shell brand and navigation", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("renders a text-only Orbita/Insight brand with the intended weight roles", async () => {
    const root = await mountWithLegacyDestinations();
    const brand = root.querySelector<HTMLElement>(".admin-brand")!;
    const title = brand.querySelector<HTMLElement>(".admin-titlebar-title")!;
    const subtitle = brand.querySelector<HTMLElement>(".admin-brand-subtitle")!;

    expect(title.textContent).toBe("Orbita");
    expect(subtitle.textContent).toBe("Insight");
    expect(brand.querySelector("svg, img, [role='img']")).toBeNull();
    expect(title.classList.contains("admin-titlebar-title")).toBe(true);
    expect(subtitle.classList.contains("admin-brand-subtitle")).toBe(true);
  });

  it("renders Chat first and Settings last, with no duplicate titlebar gear", async () => {
    const root = await mountWithLegacyDestinations();
    const nav = root.querySelector<HTMLElement>("#adminTabs")!;
    const quickEntries = [...nav.querySelectorAll<HTMLButtonElement>("button")];

    expect(nav.querySelectorAll(".admin-tab-btn")).toHaveLength(0);
    expect(quickEntries).toHaveLength(2);
    expect(quickEntries[0].classList.contains("admin-quick-btn")).toBe(true);
    expect(quickEntries[0].getAttribute("aria-label")).toBe("对话");
    expect(quickEntries[0].title).toBe("对话");
    expect(quickEntries[0].querySelector(".admin-tab-icon svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(quickEntries[0].querySelector(".admin-tab-label")?.textContent).toBe("对话");

    const settings = quickEntries[1];
    expect(settings.id).toBe("adminSettingsNavBtn");
    expect(settings.classList.contains("admin-settings-nav-btn")).toBe(true);
    expect(settings.getAttribute("aria-label")).toBe("设置");
    expect(settings.title).toBe("设置");
    expect(settings.querySelector(".admin-tab-label")?.textContent).toBe("设置");
    expect(nav.lastElementChild).toBe(settings);
    expect(root.querySelectorAll(".admin-settings-btn")).toHaveLength(0);
    expect(root.querySelectorAll(".admin-settings-nav-btn")).toHaveLength(1);
  });

  it("opens and activates the single settings content tab from the bottom nav entry", async () => {
    const root = await mountWithLegacyDestinations();
    const settings = root.querySelector<HTMLButtonElement>("#adminSettingsNavBtn")!;

    settings.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.classList.contains("is-active")).toBe(true);
    expect(settings.getAttribute("aria-current")).toBe("page");
    expect(root.querySelectorAll(".admin-settings-nav-btn")).toHaveLength(1);
    expect(root.querySelector(".admin-content .insight-dest-root.is-active")).not.toBeNull();
  });
});

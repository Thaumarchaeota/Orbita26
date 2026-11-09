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
    mount(root) {
      if (id === "settings") {
        root.innerHTML = '<div class="insight-chat-page insight-settings"><aside class="insight-chat-rail"></aside><div class="insight-chat-main"></div></div>';
        const settingsPage = root.querySelector<HTMLElement>(".insight-settings")!;
        const onToggle = () => {
          settingsPage.classList.toggle(
            "is-rail-collapsed",
            localStorage.getItem("orbita.insight.chatRailCollapsed") === "1",
          );
        };
        window.addEventListener("orbita:insight-chat-rail-toggle", onToggle);
        onToggle();
        return {
          activate: () => {},
          deactivate: () => {},
          dispose: () => window.removeEventListener("orbita:insight-chat-rail-toggle", onToggle),
        };
      } else if (id === "chat") {
        root.innerHTML = '<div class="insight-chat-page"><aside class="insight-chat-rail"></aside></div>';
      }
      return { activate: () => {}, deactivate: () => {}, dispose: () => {} };
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Insight shell chat rail ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("keeps the settings sidebar rail available while preserving chat rail expansion", async () => {
    const { registerInsightDestination } = await import("./registry");
    const { mountAdminShell } = await import("./shell");
    const { openInsightContentTab } = await import("./tab-host/host-api");
    registerInsightDestination(destination("home"));
    registerInsightDestination(destination("settings"));
    registerInsightDestination(destination("chat"));

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminShell(root);
    await flush();

    openInsightContentTab({ kind: "settings" });
    await flush();
    const workspace = root.querySelector<HTMLElement>(".admin-workspace")!;
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(false);
    expect(root.querySelector(".insight-settings .insight-chat-rail")).not.toBeNull();

    openInsightContentTab({ kind: "chat", id: "chat-test" });
    await flush();
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(true);
  });

  it("keeps the titlebar rail toggle consistent across Settings and Chat", async () => {
    const { registerInsightDestination } = await import("./registry");
    const { mountAdminShell } = await import("./shell");
    const { openInsightContentTab } = await import("./tab-host/host-api");
    registerInsightDestination(destination("home"));
    registerInsightDestination(destination("settings"));
    registerInsightDestination(destination("chat"));

    const root = document.createElement("div");
    document.body.appendChild(root);
    mountAdminShell(root);
    await flush();

    openInsightContentTab({ kind: "settings" });
    await flush();
    const workspace = root.querySelector<HTMLElement>(".admin-workspace")!;
    const toggle = root.querySelector<HTMLButtonElement>("#adminChatRailToggle")!;
    const settingsPage = root.querySelector<HTMLElement>(".insight-settings")!;
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(false);
    expect(settingsPage.classList.contains("is-rail-collapsed")).toBe(false);

    toggle.click();
    expect(settingsPage.classList.contains("is-rail-collapsed")).toBe(true);
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(false);

    openInsightContentTab({ kind: "chat", id: "chat-test" });
    await flush();
    const chatPage = root.querySelector<HTMLElement>(".insight-dest-root.is-active .insight-chat-page")!;
    expect(chatPage.classList.contains("is-rail-collapsed")).toBe(true);
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(false);

    toggle.click();
    expect(chatPage.classList.contains("is-rail-collapsed")).toBe(false);
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(true);

    openInsightContentTab({ kind: "settings" });
    await flush();
    expect(root.querySelector<HTMLElement>(".insight-settings")?.classList.contains("is-rail-collapsed")).toBe(false);
    expect(workspace.classList.contains("is-chat-rail-expanded")).toBe(false);
  });
});

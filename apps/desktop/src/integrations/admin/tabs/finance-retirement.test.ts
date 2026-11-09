import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { financeDestination } from "./finance";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("retired Finance destination boundary", () => {
  it("keeps the finance identity but mounts no legacy page or service", async () => {
    const root = document.createElement("div");
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as typeof fetch;

    try {
      const handle = financeDestination.mount(root, {
        generation: 1,
        dataDirKey: "test",
      });

      expect(financeDestination.id).toBe("finance");
      expect(root.childElementCount).toBe(0);

      await handle.activate();
      handle.deactivate();
      handle.dispose("host-dispose");

      expect(root.childElementCount).toBe(0);
      expect(invoke).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("does not clear content mounted later in the same root", () => {
    const root = document.createElement("div");
    const handle = financeDestination.mount(root, {
      generation: 1,
      dataDirKey: "test",
    });
    const laterPage = document.createElement("section");
    laterPage.dataset.page = "later";
    root.appendChild(laterPage);

    handle.dispose("host-dispose");

    expect(root.querySelector("[data-page='later']")).toBe(laterPage);
  });
});

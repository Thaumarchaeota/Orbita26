import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Set<() => void>();

vi.mock("../../state/ledger", () => ({
  onDetailMutated: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getLoadState: () => "ready",
  tryLoadOlder: async () => {},
}));
vi.mock("./filters", () => ({ getFilteredItems: () => [] }));

import { mountDetailSurface } from "./surface";

describe("DetailSurface lifecycle", () => {
  beforeEach(() => {
    listeners.clear();
    document.body.replaceChildren();
  });

  it("does not let a disposed surface receive mutations after remount", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const firstRefresh = vi.fn();
    const first = mountDetailSurface(host, { refresh: firstRefresh });
    first.dispose();

    const secondRefresh = vi.fn();
    const second = mountDetailSurface(host, { refresh: secondRefresh });
    for (const listener of listeners) listener();

    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("#detail-list")).toHaveLength(1);
    second.dispose();
  });
});

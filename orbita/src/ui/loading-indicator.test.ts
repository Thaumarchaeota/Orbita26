import { beforeEach, describe, expect, it } from "vitest";
import { mountLoadingIndicator } from "./loading-indicator";

describe("LoadingIndicator", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("exposes status role and aria-busy while loading", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const indicator = mountLoadingIndicator(host, { label: "加载中" });

    expect(indicator.root.getAttribute("role")).toBe("status");
    expect(indicator.root.getAttribute("aria-live")).toBe("polite");
    expect(indicator.root.hidden).toBe(true);
    expect(indicator.root.getAttribute("aria-busy")).toBe("false");

    indicator.setLoading(true);
    expect(indicator.root.hidden).toBe(false);
    expect(indicator.root.getAttribute("aria-busy")).toBe("true");
    expect(indicator.root.querySelector(".orbita-loading-indicator-label")?.textContent).toBe("加载中");

    indicator.setLoading(false);
    expect(indicator.root.hidden).toBe(true);
    expect(indicator.root.getAttribute("aria-busy")).toBe("false");
  });

  it("keeps accessibility attrs when reduced motion is preferred", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as MediaQueryList;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const indicator = mountLoadingIndicator(host, { size: "compact" });
    indicator.setLoading(true);

    expect(indicator.root.getAttribute("role")).toBe("status");
    expect(indicator.root.getAttribute("aria-busy")).toBe("true");
    expect(indicator.root.querySelector(".orbita-loading-indicator-spinner")).not.toBeNull();

    window.matchMedia = matchMedia;
  });
});

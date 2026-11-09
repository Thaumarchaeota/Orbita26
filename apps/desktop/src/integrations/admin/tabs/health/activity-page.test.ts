import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityListItem } from "../../../health/activity-client";

const { healthGetActivity, healthListActivities, healthReadActivityAsset } = vi.hoisted(() => ({
  healthGetActivity: vi.fn(),
  healthListActivities: vi.fn(),
  healthReadActivityAsset: vi.fn(),
}));


vi.mock("../../../health/activity-client", () => ({
  healthExportActivityFit: vi.fn(),
  healthGetActivity,
  healthListActivities,
  healthReadActivityAsset,
  healthRetryActivityOriginal: vi.fn(),
}));

import { createActivityPageHost, mountActivityListSection } from "./activity-page";

const aborters: AbortController[] = [];

function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const host = { openDetail: vi.fn(), closeDetail: vi.fn() };
  const controller = new AbortController();
  aborters.push(controller);
  return { root, host, page: mountActivityListSection(root, host, controller.signal) };
}

function activity(overrides: Partial<ActivityListItem> = {}): ActivityListItem {
  return {
    id: "activity-1",
    revision: 1,
    localDate: "2026-01-10",
    source: "garmin",
    garminActivityId: "garmin-1",
    startedAt: "2026-01-10T01:30:00Z",
    endedAt: null,
    typeKey: "running",
    title: "Morning run",
    durationSeconds: 600,
    elapsedDurationSeconds: null,
    movingDurationSeconds: null,
    distanceMeters: null,
    elevationGainMeters: null,
    avgHeartRateBpm: null,
    avgSpeedMps: null,
    avgPaceSecondsPerKm: null,
    avgPowerWatts: null,
    calories: null,
    detailStatus: null,
    suspectedDuplicateOf: null,
    createdAt: "2026-01-10T01:30:00Z",
    updatedAt: "2026-01-10T01:30:00Z",
    ...overrides,
  };
}

afterEach(() => {
  for (const controller of aborters.splice(0)) controller.abort();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Health activity list", () => {
  it("renders Garmin supplied fields as text and preserves the activity id", async () => {
    const id = 'activity" data-injected="yes';
    const title = '<img src=x onerror="window.__injected=true">';
    const typeKey = '<svg onload="window.__injected=true">';
    const localDate = '<svg onload="window.__injected=true">';
    healthListActivities.mockResolvedValue({
      activities: [activity({ id, title, typeKey, localDate })],
    });
    const { root, host, page } = mount();

    await page.reload();

    const row = root.querySelector<HTMLElement>(".health-activity-card");
    expect(row).not.toBeNull();
    expect(row?.dataset.id).toBe(id);
    expect(row?.hasAttribute("data-injected")).toBe(false);
    expect(row?.querySelector(".health-activity-card-title, .health-activity-card-when, .health-activity-row-typekey")?.querySelector("img, svg, script")).toBeNull();
    expect(root.querySelector(".health-activity-card-title")?.textContent).toBe(title);
    expect(root.querySelector(".health-activity-card-when")?.querySelector("svg")).toBeNull();
    expect(root.querySelector(".health-activity-row-typekey")?.textContent).toBe(typeKey);

    row?.click();
    expect(host.openDetail).toHaveBeenCalledWith(id);
  });

  it("shows a read error instead of presenting the failed request as an empty list", async () => {
    healthListActivities.mockRejectedValue(new Error("Archive unavailable"));
    const { root, page } = mount();

    await page.reload();

    expect(root.querySelector(".health-activity-load-error")?.textContent).toContain(
      "Archive unavailable",
    );
    expect(root.querySelector(".health-activity-empty")).toBeNull();
  });

  it("loads a GPS route into the visible activity card thumbnail", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    const notifyIntersection = (element: Element) => intersectionCallbacks.forEach((callback) => callback(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    healthListActivities.mockResolvedValue({ activities: [activity()] });
    healthGetActivity.mockResolvedValue({
      activity: activity(),
      assets: [{ kind: "details", status: "ready" }],
    });
    healthReadActivityAsset.mockResolvedValue({
      bytesBase64: btoa(JSON.stringify({
        geoPolylineDTO: {
          polyline: [
            { lat: 39.9, lon: 116.4, valid: true },
            { lat: 39.901, lon: 116.402, valid: true },
          ],
        },
      })),
    });
    const { root, page } = mount();

    await page.reload();

    const visual = root.querySelector<HTMLElement>(".health-activity-card-visual.is-map");
    expect(visual?.classList.contains("is-empty")).toBe(true);
    notifyIntersection?.(visual!);
    await vi.waitFor(() => {
      expect(visual?.classList.contains("is-route")).toBe(true);
    });
    expect(visual?.querySelector<SVGSVGElement>("svg.health-activity-route-thumbnail")).not.toBeNull();
    expect(visual?.querySelector(".health-activity-route-attribution")?.textContent).toBe("© OpenStreetMap");
    expect(healthGetActivity).toHaveBeenCalledWith("activity-1");
    expect(healthReadActivityAsset).toHaveBeenCalledWith("activity-1", "details");
  });

  it("keeps the no-route placeholder when the activity has no usable GPS points", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    const notifyIntersection = (element: Element) => intersectionCallbacks.forEach((callback) => callback(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    healthListActivities.mockResolvedValue({ activities: [activity()] });
    healthGetActivity.mockResolvedValue({
      activity: activity(),
      assets: [{ kind: "details", status: "ready" }],
    });
    healthReadActivityAsset.mockResolvedValue({
      bytesBase64: btoa(JSON.stringify({ geoPolylineDTO: { polyline: [] } })),
    });
    const { root, page } = mount();

    await page.reload();

    const visual = root.querySelector<HTMLElement>(".health-activity-card-visual.is-map");
    notifyIntersection?.(visual!);
    await vi.waitFor(() => {
      expect(visual?.classList.contains("is-empty")).toBe(true);
      expect(visual?.textContent).toContain("暂无路线");
    });
    expect(visual?.querySelector(".health-activity-route-thumbnail")).toBeNull();
  });

  it("does not let a slower activity route replace another card thumbnail", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    const notifyIntersection = (element: Element) => intersectionCallbacks.forEach((callback) => callback(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const first = activity({ id: "activity-1", title: "First run" });
    const second = activity({ id: "activity-2", title: "Second run" });
    healthListActivities.mockResolvedValue({ activities: [first, second] });
    let resolveFirst!: (value: { activity: ActivityListItem; assets: { kind: string; status: string }[] }) => void;
    let resolveSecond!: (value: { activity: ActivityListItem; assets: { kind: string; status: string }[] }) => void;
    const firstDetail = new Promise<{ activity: ActivityListItem; assets: { kind: string; status: string }[] }>((resolve) => { resolveFirst = resolve; });
    const secondDetail = new Promise<{ activity: ActivityListItem; assets: { kind: string; status: string }[] }>((resolve) => { resolveSecond = resolve; });
    healthGetActivity.mockImplementation((id: string) => id === first.id ? firstDetail : secondDetail);
    healthReadActivityAsset.mockImplementation((id: string) => Promise.resolve({
      bytesBase64: btoa(JSON.stringify(id === first.id
        ? { geoPolylineDTO: { polyline: [] } }
        : { geoPolylineDTO: { polyline: [
          { lat: 39.9, lon: 116.4, valid: true },
          { lat: 39.901, lon: 116.402, valid: true },
        ] } })),
    }));
    const { root, page } = mount();

    await page.reload();

    const firstVisual = root.querySelector<HTMLElement>('[data-id="activity-1"] .health-activity-card-visual');
    const secondVisual = root.querySelector<HTMLElement>('[data-id="activity-2"] .health-activity-card-visual');
    notifyIntersection?.(firstVisual!);
    notifyIntersection?.(secondVisual!);
    await vi.waitFor(() => expect(healthGetActivity).toHaveBeenCalledTimes(2));
    const assets = [{ kind: "details", status: "ready" }];
    resolveSecond({ activity: second, assets });
    await vi.waitFor(() => expect(healthReadActivityAsset).toHaveBeenCalledWith(second.id, "details"));
    await vi.waitFor(() => expect(secondVisual?.classList.contains("is-route")).toBe(true));
    resolveFirst({ activity: first, assets });
    await vi.waitFor(() => expect(firstVisual?.classList.contains("is-empty")).toBe(true));

    expect(firstVisual?.textContent).toContain("暂无路线");
    expect(firstVisual?.querySelector(".health-activity-route-thumbnail")).toBeNull();
    expect(secondVisual?.classList.contains("is-route")).toBe(true);
    expect(secondVisual?.querySelector("svg.health-activity-route-thumbnail")).not.toBeNull();
  });

  it("does not render a route after its card is replaced while GPS is loading", async () => {
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersectionCallbacks.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const first = activity({ id: "old-card" });
    healthListActivities.mockResolvedValue({ activities: [first] });
    let resolveDetails!: (value: { activity: ActivityListItem; assets: { kind: string; status: string }[] }) => void;
    healthGetActivity.mockReturnValue(new Promise((resolve) => { resolveDetails = resolve; }));
    const { root, page } = mount();
    await page.reload();
    const visual = root.querySelector<HTMLElement>(".health-activity-card-visual")!;
    intersectionCallbacks.forEach((callback) => callback(
      [{ target: visual, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ));
    await vi.waitFor(() => expect(healthGetActivity).toHaveBeenCalledWith(first.id));

    const search = root.querySelector<HTMLInputElement>("[data-field='search']")!;
    search.value = "no matching activity";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    resolveDetails({ activity: first, assets: [{ kind: "details", status: "ready" }] });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector(".health-activity-empty")).not.toBeNull();
  });

});

describe("Health activity detail map", () => {
  it("draws the route and tiles in one SVG coordinate system and zooms", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new AbortController();
    aborters.push(controller);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    healthGetActivity.mockResolvedValue({
      activity: activity(),
      assets: [{ kind: "details", status: "ready" }],
    });
    healthReadActivityAsset.mockResolvedValue({
      bytesBase64: btoa(JSON.stringify({
        geoPolylineDTO: {
          polyline: [
            { lat: 39.9, lon: 116.4, valid: true },
            { lat: 39.901, lon: 116.402, valid: true },
          ],
        },
      })),
    });

    createActivityPageHost(root, controller.signal).openDetail("activity-1");

    const svg = await vi.waitFor(() => {
      const canvas = root.querySelector<SVGSVGElement>(".health-activity-map-canvas");
      expect(canvas).not.toBeNull();
      return canvas!;
    });
    expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 /);
    expect(svg?.querySelector("polyline")?.getAttribute("points")).toContain(",");
    expect(svg?.querySelectorAll("image").length).toBeGreaterThan(0);

    const zoomIn = root.querySelector<HTMLButtonElement>("[aria-label='放大地图']");
    const before = svg?.querySelector("image")?.getAttribute("href");
    zoomIn?.click();
    expect(svg?.querySelector("image")?.getAttribute("href")).not.toBe(before);
    raf.mockRestore();
  });

  it("shows a route status instead of rendering invalid GPS data", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = new AbortController();
    aborters.push(controller);
    healthGetActivity.mockResolvedValue({
      activity: activity(),
      assets: [{ kind: "details", status: "ready" }],
    });
    healthReadActivityAsset.mockResolvedValue({
      bytesBase64: btoa(JSON.stringify({
        geoPolylineDTO: { polyline: [{ lat: 100, lon: 116.4, valid: true }] },
      })),
    });

    createActivityPageHost(root, controller.signal).openDetail("activity-1");

    await vi.waitFor(() => {
      expect(root.querySelector(".health-activity-map-notice")?.textContent).toContain(
        "没有可用的 GPS 轨迹",
      );
    });
    expect(root.querySelector(".health-activity-map-controls")?.hasAttribute("hidden")).toBe(true);
  });
});

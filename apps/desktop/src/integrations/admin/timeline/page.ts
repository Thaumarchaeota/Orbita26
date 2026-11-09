import type { InsightDestinationHandle, InsightHostContext } from "../types";
import { beijingToday, defaultTrackWindow } from "../tabs/health/format";
import { createTimelineClock, getTimelineSources, type TimelineLayerHandle } from "./sources";
import "../tabs/health/health.css";
import "./timeline.css";

export function mountTimelinePage(
  root: HTMLElement,
  _ctx: InsightHostContext,
): InsightDestinationHandle {
  const ac = new AbortController();

  root.innerHTML = `
    <div class="timeline-app">
      <div class="timeline-scroll">
        <div data-region="tracks"></div>
      </div>
      <aside class="timeline-detail-rail arrangement-detail-rail" data-region="timeline-detail"></aside>
    </div>`;

  const tracksMount = root.querySelector<HTMLElement>('[data-region="tracks"]')!;
  const detailHost = root.querySelector<HTMLElement>('[data-region="timeline-detail"]')!;
  const today = beijingToday();
  const clock = createTimelineClock({ ...defaultTrackWindow(today), selectedDate: today });
  const handles: TimelineLayerHandle[] = [];
  let healthStack: HTMLElement | null = null;
  for (const source of getTimelineSources()) {
    if (source.id === "productivity" && healthStack) {
      const host = document.createElement("article");
      const firstCard = healthStack.querySelector(".health-track-card");
      if (firstCard) healthStack.insertBefore(host, firstCard);
      else healthStack.appendChild(host);
      handles.push(source.mount(host, { signal: ac.signal, clock, detailHost }));
      continue;
    }
    const layer = document.createElement("div");
    layer.className = "timeline-layer";
    layer.dataset.source = source.id;
    tracksMount.appendChild(layer);
    handles.push(source.mount(layer, { signal: ac.signal, clock }));
    if (source.id === "health") {
      healthStack = layer.querySelector(".health-tracks-stack");
    }
  }

  return {
    activate() {
      for (const handle of handles) void handle.activate();
    },
    deactivate() {
      for (const handle of handles) handle.deactivate();
    },
    dispose() {
      for (const handle of [...handles].reverse()) handle.dispose();
      ac.abort();
      root.innerHTML = "";
    },
  };
}

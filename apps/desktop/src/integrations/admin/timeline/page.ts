import type { InsightDestinationHandle, InsightHostContext } from "../types";
import type { HealthTracksViewHandle } from "./health-tracks-view";
import { getTimelineSources } from "./sources";
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
    </div>`;

  const tracksMount = root.querySelector<HTMLElement>('[data-region="tracks"]')!;
  const handles: HealthTracksViewHandle[] = [];
  for (const source of getTimelineSources()) {
    const layer = document.createElement("div");
    layer.className = "timeline-layer";
    layer.dataset.source = source.id;
    tracksMount.appendChild(layer);
    handles.push(source.mount(layer, { signal: ac.signal }));
  }

  return {
    activate() {
      for (const handle of handles) void handle.activate();
    },
    deactivate() {
      for (const handle of handles) handle.deactivate();
    },
    dispose() {
      for (const handle of handles) handle.dispose();
      ac.abort();
      root.innerHTML = "";
    },
  };
}

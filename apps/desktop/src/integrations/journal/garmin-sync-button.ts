import { beijingToday, formatGarminError, garminSync, syncFromDate } from "./client";
import { getSettings } from "../../core/settings";
import { normalizeGarminSyncDays } from "../../core/data/garmin-sync-days";

export const GARMIN_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

export const GARMIN_REFRESH_DONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="ticktick-check-path" d="M7.5 12.2l2.6 2.6 5.4-5.4"/></svg>`;

const SUCCESS_MS = 1600;

export function garminSyncButtonMarkup(opts?: { tip?: string; region?: string; id?: string }): string {
  const tip = opts?.tip ?? "同步佳明";
  const region = opts?.region ? ` data-region="${opts.region}"` : "";
  const id = opts?.id ? ` id="${opts.id}"` : "";
  return `<button type="button" class="ticktick-icon-btn"${id}${region} data-tip="${tip}" aria-label="${tip}">
    <span class="ticktick-refresh-icon">${GARMIN_REFRESH_SVG}</span>
    <span class="ticktick-refresh-done">${GARMIN_REFRESH_DONE_SVG}</span>
  </button>`;
}

export type BindGarminSyncButtonOptions = {
  from?: string;
  to?: string;
  onSuccess?: () => void | Promise<void>;
  signal?: AbortSignal;
};

export function bindGarminSyncButton(
  btn: HTMLButtonElement,
  opts: BindGarminSyncButtonOptions = {},
): () => void {
  let syncing = false;

  const run = async () => {
    if (syncing) return;
    syncing = true;
    btn.disabled = true;
    btn.classList.remove("is-success");
    btn.classList.add("is-spinning");
    try {
      const res = await garminSync({
        from: opts.from ?? syncFromDate(normalizeGarminSyncDays(getSettings().integrations.garmin.syncDays)),
        to: opts.to ?? beijingToday(),
      });
      if (res.ok) {
        btn.classList.add("is-success");
        window.setTimeout(() => btn.classList.remove("is-success"), SUCCESS_MS);
        await opts.onSuccess?.();
      } else {
        alert(formatGarminError(res.reason, res.message));
      }
    } catch (e) {
      alert(String(e));
    } finally {
      syncing = false;
      btn.classList.remove("is-spinning");
      btn.disabled = false;
    }
  };

  const onClick = () => void run();
  btn.addEventListener("click", onClick);
  const dispose = () => btn.removeEventListener("click", onClick);
  opts.signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}

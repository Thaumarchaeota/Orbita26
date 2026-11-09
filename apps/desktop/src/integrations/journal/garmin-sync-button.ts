import {
  beijingToday,
  formatGarminError,
  garminSync,
  isGarminSyncing,
  subscribeGarminSyncing,
  syncFromDate,
} from "./client";
import { getSettings } from "../../core/settings";
import { normalizeGarminSyncDays } from "../../core/data/garmin-sync-days";

export const GARMIN_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

export const GARMIN_REFRESH_DONE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path class="ticktick-check-path" d="M7.5 12.2l2.6 2.6 5.4-5.4"/></svg>`;

const SUCCESS_MS = 1600;
const IDLE_TIP = "同步佳明";
const BUSY_TIP = "正在同步佳明，请勿重复点击";

export function garminSyncButtonMarkup(opts?: { tip?: string; region?: string; id?: string; accent?: boolean }): string {
  const tip = opts?.tip ?? IDLE_TIP;
  const region = opts?.region ? ` data-region="${opts.region}"` : "";
  const id = opts?.id ? ` id="${opts.id}"` : "";
  const accent = opts?.accent ? " garmin-sync-accent" : "";
  return `<span class="garmin-sync-control">
    <button type="button" class="ticktick-icon-btn${accent}"${id}${region} data-tip="${tip}" aria-label="${tip}">
      <span class="ticktick-refresh-icon">${GARMIN_REFRESH_SVG}</span>
      <span class="ticktick-refresh-done">${GARMIN_REFRESH_DONE_SVG}</span>
    </button>
  </span>`;
}

export type BindGarminSyncButtonOptions = {
  from?: string;
  to?: string;
  beforeSync?: () => void | Promise<void>;
  onSuccess?: (result: Awaited<ReturnType<typeof garminSync>>) => void | Promise<void>;
  onError?: (message: string) => void | Promise<void>;
  signal?: AbortSignal;
};

export function bindGarminSyncButton(
  btn: HTMLButtonElement,
  opts: BindGarminSyncButtonOptions = {},
): () => void {
  const idleTip = btn.dataset.tip || IDLE_TIP;
  let successTimer = 0;
  let disposed = false;

  const paint = (busy: boolean) => {
    btn.disabled = busy;
    btn.classList.toggle("is-spinning", busy);
    btn.dataset.tip = busy ? BUSY_TIP : idleTip;
    btn.setAttribute("aria-label", busy ? BUSY_TIP : idleTip);
    btn.setAttribute("aria-busy", busy ? "true" : "false");
  };

  const unsub = subscribeGarminSyncing(paint);

  const run = async () => {
    if (isGarminSyncing()) return;
    btn.classList.remove("is-success");
    try {
      await opts.beforeSync?.();
      if (disposed) return;
      const res = await garminSync({
        from: opts.from ?? syncFromDate(normalizeGarminSyncDays(getSettings().integrations.garmin.syncDays)),
        to: opts.to ?? beijingToday(),
      });
      if (disposed) return;
      if (res.ok) {
        btn.classList.add("is-success");
        if (successTimer) window.clearTimeout(successTimer);
        successTimer = window.setTimeout(() => {
          successTimer = 0;
          btn.classList.remove("is-success");
        }, SUCCESS_MS);
        await opts.onSuccess?.(res);
      } else if (res.reason !== "GARMIN_SYNC_IN_PROGRESS" && res.reason !== "GARMIN_SYNC_CANCELLED") {
        await (opts.onError ?? ((message: string) => alert(message)))(formatGarminError(res.reason, res.message));
      }
    } catch (e) {
      if (disposed) return;
      await (opts.onError ?? ((message: string) => alert(message)))(String(e));
    }
  };

  const onClick = () => void run();
  btn.addEventListener("click", onClick);
  const dispose = () => {
    disposed = true;
    btn.removeEventListener("click", onClick);
    unsub();
    if (successTimer) {
      window.clearTimeout(successTimer);
      successTimer = 0;
    }
    btn.classList.remove("is-success");
  };
  opts.signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}

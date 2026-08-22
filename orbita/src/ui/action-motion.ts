export const ACTION_SUCCESS_MS = 900;
export const ACTION_ERROR_MS = 600;
export const ACTION_SHAKE_MS = 350;
export const ACTION_REJECT_MS = 450;
export const ACTION_PENDING_MIN_MS = 120;

export const ACTION_CHECK_ICON =
  '<svg class="orbita-action-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const ACTION_PENDING_SPINNER =
  '<span class="orbita-action-spinner" aria-hidden="true"></span>';

const ACTION_MOTION_CLASSES = [
  "is-action-success",
  "is-action-error",
  "is-action-pending",
  "is-action-shake",
  "is-action-shake-strong",
  "is-success",
  "is-error",
  "is-pending",
  "save-success",
  "save-error",
] as const;

const heldButtons = new Set<HTMLButtonElement>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function flushActionPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function withActionPending<T>(
  btn: HTMLButtonElement,
  opts: { label: string; spinning?: boolean },
  fn: () => T | Promise<T>,
): Promise<T> {
  applyActionPendingVisual(btn, { label: opts.label, spinning: opts.spinning });
  const start = Date.now();
  await flushActionPaint();
  const result = await fn();
  const elapsed = Date.now() - start;
  if (elapsed < ACTION_PENDING_MIN_MS) {
    await sleep(ACTION_PENDING_MIN_MS - elapsed);
  }
  return result;
}

export function ensureActionButton(btn: HTMLButtonElement): void {
  btn.classList.add("orbita-action-btn");
}

export function isActionVisualHeld(btn: HTMLButtonElement): boolean {
  return heldButtons.has(btn);
}

export type ActionMotionHandle = {
  release: () => void;
};

export function holdActionVisual(btn: HTMLButtonElement): ActionMotionHandle {
  ensureActionButton(btn);
  heldButtons.add(btn);
  return {
    release: () => {
      heldButtons.delete(btn);
    },
  };
}

function clearActionStates(btn: HTMLButtonElement): void {
  for (const name of ACTION_MOTION_CLASSES) btn.classList.remove(name);
}

export function clearActionMotion(btn: HTMLButtonElement): void {
  clearActionStates(btn);
}

export function applyActionPendingVisual(
  btn: HTMLButtonElement,
  opts: { label: string; spinning?: boolean; disabled?: boolean },
): void {
  ensureActionButton(btn);
  clearActionStates(btn);
  btn.classList.add("is-action-pending");
  btn.disabled = opts.disabled ?? true;
  if (opts.spinning !== false) {
    btn.innerHTML = `${ACTION_PENDING_SPINNER}${opts.label}`;
  } else {
    btn.textContent = opts.label;
  }
}

export function applyActionSuccessVisual(btn: HTMLButtonElement): void {
  ensureActionButton(btn);
  clearActionStates(btn);
  btn.classList.add("is-action-success");
  btn.disabled = true;
  btn.innerHTML = ACTION_CHECK_ICON;
}

export async function playActionSuccess(
  btn: HTMLButtonElement,
  opts?: { minMs?: number; hold?: boolean; onDone?: () => void },
): Promise<void> {
  const hold = opts?.hold === false ? null : holdActionVisual(btn);
  applyActionSuccessVisual(btn);
  await sleep(opts?.minMs ?? ACTION_SUCCESS_MS);
  hold?.release();
  btn.classList.remove("is-action-success");
  opts?.onDone?.();
}

export async function playActionShake(
  btn: HTMLButtonElement,
  ms = ACTION_SHAKE_MS,
): Promise<void> {
  ensureActionButton(btn);
  btn.classList.add("is-action-shake");
  await sleep(ms);
  btn.classList.remove("is-action-shake");
}

export async function playActionError(btn: HTMLButtonElement): Promise<void> {
  ensureActionButton(btn);
  clearActionStates(btn);
  btn.classList.add("is-action-error", "is-action-shake-strong");
  btn.disabled = true;
  btn.textContent = "✕";
  await sleep(ACTION_REJECT_MS);
  btn.classList.remove("is-action-error", "is-action-shake-strong");
  btn.disabled = false;
}

export async function playRejectShake(el: HTMLElement, ms = ACTION_REJECT_MS): Promise<void> {
  el.classList.add("orbita-action-reject");
  await sleep(ms);
  el.classList.remove("orbita-action-reject");
}

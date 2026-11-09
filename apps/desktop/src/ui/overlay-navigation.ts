export type OverlayNavigationKind = "protected" | "temporary" | "navigation-detail";

export type OverlayNavigationRegistration = {
  kind: OverlayNavigationKind;
  close?: () => void | Promise<void>;
};

export type OverlayNavigationRegistrar = (overlay: OverlayNavigationRegistration) => () => void;

type RecordEntry = { overlay: OverlayNavigationRegistration; releaseHost?: () => void };
const records = new Set<RecordEntry>();
let registrar: OverlayNavigationRegistrar | null = null;
let installation = Symbol();

/** Explicit owner semantics only; see SPEC-0014 §5. Panel installs no registrar. */
export function registerOverlayNavigation(overlay: OverlayNavigationRegistration): () => void {
  const record: RecordEntry = { overlay };
  records.add(record);
  record.releaseHost = registrar?.(overlay);
  return () => {
    if (!records.delete(record)) return;
    record.releaseHost?.();
    record.releaseHost = undefined;
  };
}

export function hasBlockingOverlayNavigation(): boolean {
  return [...records].some(({ overlay }) => overlay.kind !== "navigation-detail");
}

/** Rebind retained open records; stale Host cleanup must not uninstall its successor. */
export function setOverlayNavigationRegistrar(next: OverlayNavigationRegistrar | null): () => void {
  const identity = installation = Symbol();
  if (registrar !== next) {
    for (const record of records) {
      record.releaseHost?.();
      record.releaseHost = undefined;
    }
    registrar = next;
    for (const record of records) record.releaseHost = next?.(record.overlay);
  }
  return () => {
    if (installation === identity) setOverlayNavigationRegistrar(null);
  };
}

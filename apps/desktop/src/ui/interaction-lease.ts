export type InteractionReason = "modal" | "popover" | "drag" | "edit";

export type InteractionLease = {
  ready: Promise<void>;
  release: () => void;
};

type InteractionBridge = {
  acquire: () => Promise<void>;
  changed: () => void;
};

let bridge: InteractionBridge | null = null;
const leases = new Map<symbol, InteractionReason>();

export function installInteractionBridge(next: InteractionBridge): void {
  bridge = next;
  void next.acquire().catch(() => {});
}

export function hasInteractionLeases(): boolean {
  return leases.size > 0;
}

export function acquireInteraction(reason: InteractionReason): InteractionLease {
  const token = Symbol(reason);
  leases.set(token, reason);
  bridge?.changed();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    leases.delete(token);
    bridge?.changed();
  };
  const currentBridge = bridge;
  const ready = Promise.resolve().then(() => currentBridge?.acquire()).then(() => undefined).catch((error) => {
    release();
    throw error;
  });
  return {
    ready,
    release,
  };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasBlockingOverlayNavigation, registerOverlayNavigation, setOverlayNavigationRegistrar,
  type OverlayNavigationRegistration,
} from "./overlay-navigation";

const releases: Array<() => void> = [];
function register(overlay: OverlayNavigationRegistration) {
  const release = registerOverlayNavigation(overlay);
  releases.push(release);
  return release;
}
afterEach(() => {
  releases.splice(0).forEach((release) => release());
  setOverlayNavigationRegistrar(null);
});

describe("overlay navigation owner registry", () => {
  it("retains intent without a Host and distinguishes details from blockers", () => {
    register({ kind: "navigation-detail" });
    expect(hasBlockingOverlayNavigation()).toBe(false);
    const release = register({ kind: "temporary", close: vi.fn() });
    expect(hasBlockingOverlayNavigation()).toBe(true);
    const hostRelease = vi.fn();
    const host = vi.fn((_overlay: OverlayNavigationRegistration) => hostRelease);
    setOverlayNavigationRegistrar(host);
    expect(host.mock.calls.map(([overlay]) => overlay.kind)).toEqual(["navigation-detail", "temporary"]);
    release(); release();
    expect(hostRelease).toHaveBeenCalledTimes(1);
    expect(hasBlockingOverlayNavigation()).toBe(false);
  });

  it("rebinds in order and ignores obsolete installation cleanup", () => {
    register({ kind: "temporary" });
    register({ kind: "protected" });
    const oldRelease = vi.fn();
    const old = vi.fn(() => oldRelease);
    const cleanupOld = setOverlayNavigationRegistrar(old);
    const next = vi.fn(() => vi.fn());
    const cleanupNext = setOverlayNavigationRegistrar(next);
    expect(oldRelease).toHaveBeenCalledTimes(2);
    cleanupOld();
    expect(next).toHaveBeenCalledTimes(2);
    register({ kind: "navigation-detail" });
    expect(next).toHaveBeenCalledTimes(3);
    cleanupNext();
    expect(hasBlockingOverlayNavigation()).toBe(true);
  });

  it("does not rebind the same registrar, but replaces cleanup ownership", () => {
    register({ kind: "protected" });
    const release = vi.fn();
    const host = vi.fn(() => release);
    const obsolete = setOverlayNavigationRegistrar(host);
    const current = setOverlayNavigationRegistrar(host);
    obsolete();
    expect(release).not.toHaveBeenCalled();
    expect(host).toHaveBeenCalledTimes(1);
    current();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

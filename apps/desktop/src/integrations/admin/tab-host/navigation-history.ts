import type { InsightDestinationId } from "../types";
import type { ActiveSurface } from "./identity";

export type NavigationFrame = {
  id: string;
  hostEpoch: number;
  dataDirKey: string;
  surface: ActiveSurface;
  tabInstanceId?: string;
  route: { version: 1; destination: InsightDestinationId; value: unknown };
  context: unknown;
};

/** Route values contain identities only; context is deliberately excluded (SPEC-0014 §3). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sameNavigationRoute(a: NavigationFrame, b: NavigationFrame): boolean {
  return a.hostEpoch === b.hostEpoch && a.dataDirKey === b.dataDirKey &&
    a.tabInstanceId === b.tabInstanceId && canonical(a.surface) === canonical(b.surface) &&
    canonical(a.route) === canonical(b.route);
}

/** Process memory only. Session/layout persistence must never serialize these frames. */
export class NavigationHistory {
  private frames: NavigationFrame[] = [];
  private cursor = -1;

  get current(): NavigationFrame | undefined { return this.frames[this.cursor]; }
  get length(): number { return this.frames.length; }
  get position(): number { return this.cursor; }

  reset(frame?: NavigationFrame): void {
    this.frames = frame ? [frame] : [];
    this.cursor = frame ? 0 : -1;
  }

  replaceCurrent(frame: NavigationFrame): void {
    if (this.cursor < 0) this.reset(frame);
    else this.frames[this.cursor] = frame;
  }

  visit(frame: NavigationFrame, returnToPrevious = false): void {
    if (this.current && sameNavigationRoute(this.current, frame)) {
      this.replaceCurrent(frame);
      return;
    }
    if (returnToPrevious && this.cursor > 0 && sameNavigationRoute(this.frames[this.cursor - 1], frame)) {
      this.frames[--this.cursor] = frame;
      return;
    }
    this.frames.splice(this.cursor + 1);
    this.frames.push(frame);
    if (this.frames.length > 200) this.frames.splice(0, this.frames.length - 200);
    this.cursor = this.frames.length - 1;
  }

  adjacent(direction: -1 | 1): NavigationFrame | undefined {
    return this.frames[this.cursor + direction];
  }

  commit(frame: NavigationFrame): void {
    const index = this.frames.findIndex((candidate) => candidate.id === frame.id);
    if (index >= 0) this.cursor = index;
  }

  remove(predicate: (frame: NavigationFrame) => boolean): void {
    const old = this.frames;
    const retained: NavigationFrame[] = [];
    let nextCursor = -1;
    for (let index = 0; index < old.length; index++) {
      const frame = old[index];
      if (predicate(frame)) continue;
      if (!retained.length || !sameNavigationRoute(retained[retained.length - 1], frame)) retained.push(frame);
      if (index <= this.cursor) nextCursor = retained.length - 1;
    }
    this.frames = retained;
    this.cursor = nextCursor < 0 && retained.length ? 0 : nextCursor;
  }
}

/** Direction input is bounded; ordinary navigation waits and rechecks its epoch. */
export class NavigationChannel {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  run<T>(action: () => Promise<T>, direction = false): Promise<T | undefined> {
    if (direction && this.pending > 0) return Promise.resolve(undefined);
    this.pending++;
    const next = this.tail.then(action, action);
    this.tail = next.catch(() => undefined);
    return next.finally(() => { this.pending--; });
  }
}

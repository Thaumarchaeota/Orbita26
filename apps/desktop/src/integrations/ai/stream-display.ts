const DEFAULT_INTERVAL_MS = 50;
const FADE_MS = 180;

export type StreamDisplayOptions = {
  intervalMs?: number;
  fadeMs?: number;
  onFlush: (visibleText: string, isFinal: boolean) => void;
};

export class StreamDisplayQueue {
  private buffer = "";
  private visible = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly fadeMs: number;
  private readonly onFlush: (visibleText: string, isFinal: boolean) => void;
  private readonly reducedMotion: boolean;

  constructor(opts: StreamDisplayOptions) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.fadeMs = opts.fadeMs ?? FADE_MS;
    this.onFlush = opts.onFlush;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  get fadeDurationMs(): number {
    return this.reducedMotion ? 0 : this.fadeMs;
  }

  push(delta: string) {
    if (!delta) return;
    this.buffer += delta;
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), this.intervalMs);
    }
  }

  flushNow() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      this.visible += this.buffer;
      this.buffer = "";
    }
    this.onFlush(this.visible, true);
  }

  get visibleText(): string {
    return this.visible;
  }

  get fullText(): string {
    return this.visible + this.buffer;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.visible += this.buffer;
    this.buffer = "";
  }

  dispose() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    if (this.buffer.length === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }
    this.visible += this.buffer;
    this.buffer = "";
    this.onFlush(this.visible, false);
  }
}

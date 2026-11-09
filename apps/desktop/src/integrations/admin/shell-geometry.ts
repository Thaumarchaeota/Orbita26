export const SHELL_GAP = 8;
export const RAIL_MIN = 160;
export const RAIL_MAX = 400;
export const PANE_MIN = 240;
export const SINGLE_CONTENT_MIN = 480;
export const DUAL_CONTENT_MIN = 481;

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function themeRailDefaultWidth(): number {
  return 232;
}

export type RailWidthInput = {
  W: number;
  P: number;
  railExpanded: boolean;
  Rpreferred: number;
  rightVisible: boolean;
};

export function computeRailWidth(input: RailWidthInput): number {
  const B = input.rightVisible ? DUAL_CONTENT_MIN : SINGLE_CONTENT_MIN;
  const Rbudget = Math.min(RAIL_MAX, input.W - input.P - B);
  if (!(input.railExpanded && input.W >= input.P + RAIL_MIN + B)) return 0;
  return clamp(input.Rpreferred, RAIL_MIN, Rbudget);
}

export function computeLeftTabInset(H: number, contentLeft: number): number {
  return Math.max(0, H + SHELL_GAP - contentLeft);
}

export function computeLeftTabX(contentLeft: number, H: number): number {
  return Math.max(contentLeft, H + SHELL_GAP);
}

export type PaneWidthResult = {
  leftWidth: number;
  rightWidth: number;
  contentOverflow: boolean;
};

export function computePaneWidths(
  A: number,
  rightVisible: boolean,
  leftDesired: number,
): PaneWidthResult {
  if (!rightVisible) {
    return { leftWidth: Math.max(0, A), rightWidth: 0, contentOverflow: false };
  }
  if (A >= DUAL_CONTENT_MIN) {
    const leftWidth = clamp(leftDesired, PANE_MIN, A - (PANE_MIN + 1));
    return { leftWidth, rightWidth: A - leftWidth - 1, contentOverflow: false };
  }
  return { leftWidth: PANE_MIN, rightWidth: PANE_MIN, contentOverflow: true };
}

export type ShellGeometryInput = {
  W: number;
  P: number;
  H: number;
  railExpanded: boolean;
  Rpreferred: number;
  rightVisible: boolean;
  leftDesired: number;
};

export type ShellGeometry = {
  P: number;
  R: number;
  Rbudget: number;
  leftWidth: number;
  rightWidth: number;
  leftTabInset: number;
  leftTabX: number;
  contentLeft: number;
  contentOverflow: boolean;
};

export function computeShellGeometry(input: ShellGeometryInput): ShellGeometry {
  const B = input.rightVisible ? DUAL_CONTENT_MIN : SINGLE_CONTENT_MIN;
  const Rbudget = Math.min(RAIL_MAX, input.W - input.P - B);
  const R = computeRailWidth(input);
  const contentLeft = input.P + R;
  const panes = computePaneWidths(input.W - input.P - R, input.rightVisible, input.leftDesired);
  return {
    P: input.P,
    R,
    Rbudget,
    leftWidth: panes.leftWidth,
    rightWidth: panes.rightWidth,
    leftTabInset: computeLeftTabInset(input.H, contentLeft),
    leftTabX: computeLeftTabX(contentLeft, input.H),
    contentLeft,
    contentOverflow: panes.contentOverflow,
  };
}

const STYLE_VARS = {
  P: "--shell-primary-width",
  R: "--shell-rail-width",
  left: "--shell-left-width",
  right: "--shell-right-width",
  inset: "--shell-left-tab-inset",
} as const;

function px(n: number): string {
  return `${n}px`;
}

export function geometryVarsEqual(a: ShellGeometry, b: ShellGeometry): boolean {
  return (
    a.P === b.P &&
    a.R === b.R &&
    a.leftWidth === b.leftWidth &&
    a.rightWidth === b.rightWidth &&
    a.leftTabInset === b.leftTabInset &&
    a.contentOverflow === b.contentOverflow
  );
}

export function writeGeometryVars(target: HTMLElement, geo: ShellGeometry): void {
  target.style.setProperty(STYLE_VARS.P, px(geo.P));
  target.style.setProperty(STYLE_VARS.R, px(geo.R));
  target.style.setProperty(STYLE_VARS.left, px(geo.leftWidth));
  target.style.setProperty(STYLE_VARS.right, px(geo.rightWidth));
  target.style.setProperty(STYLE_VARS.inset, px(geo.leftTabInset));
}

const RAIL_MOTION_MS = 200;

function railMotionEase(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const x1 = 0.4;
  const y1 = 0;
  const x2 = 0.2;
  const y2 = 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const dx = sampleX(t) - x;
    const d = sampleDX(t);
    if (Math.abs(dx) < 1e-4 || Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - dx / d));
  }
  return sampleY(t);
}

function geometryAtRail(
  input: ShellGeometryInput,
  R: number,
): ShellGeometry {
  const B = input.rightVisible ? DUAL_CONTENT_MIN : SINGLE_CONTENT_MIN;
  const contentLeft = input.P + R;
  const panes = computePaneWidths(input.W - input.P - R, input.rightVisible, input.leftDesired);
  return {
    P: input.P,
    R,
    Rbudget: Math.min(RAIL_MAX, input.W - input.P - B),
    leftWidth: panes.leftWidth,
    rightWidth: panes.rightWidth,
    leftTabInset: computeLeftTabInset(input.H, contentLeft),
    leftTabX: computeLeftTabX(contentLeft, input.H),
    contentLeft,
    contentOverflow: panes.contentOverflow,
  };
}

export type ShellGeometryHost = {
  varTarget: HTMLElement;
  shell: HTMLElement;
  primaryNav: HTMLElement;
  chromeControls: HTMLElement;
  getIntent: (measured: { W: number; P: number; H: number }) => {
    railExpanded: boolean;
    Rpreferred: number;
    rightVisible: boolean;
    leftDesired: number;
  };
  onApplied?: (geo: ShellGeometry) => void;
};

export type ShellGeometryController = {
  scheduleGeometry: () => void;
  applyNow: () => void;
  dispose: () => void;
  last: () => ShellGeometry | null;
};

export function createShellGeometryController(host: ShellGeometryHost): ShellGeometryController {
  let raf = 0;
  let motionRaf = 0;
  let last: ShellGeometry | null = null;
  let ready = false;
  let railMotion: { fromR: number; toExpanded: boolean; start: number } | null = null;

  function measure(): { W: number; P: number; H: number } {
    const shellRect = host.shell.getBoundingClientRect();
    const navRect = host.primaryNav.getBoundingClientRect();
    const controlsRect = host.chromeControls.getBoundingClientRect();
    return {
      W: host.shell.clientWidth,
      P: navRect.width,
      H: controlsRect.right - shellRect.left,
    };
  }

  function publish(
    geo: ShellGeometry,
    rightVisible: boolean,
    changed: boolean,
    contentWidth: number,
  ): void {
    host.varTarget.style.setProperty("--shell-rail-content-width", px(contentWidth));
    if (changed) {
      writeGeometryVars(host.varTarget, geo);
      host.varTarget.classList.toggle("has-right-pane", rightVisible);
      host.varTarget.classList.toggle("is-rail-expanded", geo.R > 0);
      host.varTarget.classList.toggle("is-content-overflow", geo.contentOverflow);
    }
    last = geo;
    if (!ready) {
      ready = true;
      host.varTarget.classList.add("is-geometry-ready");
    }
    if (changed) host.onApplied?.(geo);
  }

  function applyNow(): void {
    const measured = measure();
    const intent = host.getIntent(measured);
    const input = { ...measured, ...intent };
    const target = computeShellGeometry(input);
    const targetExpanded = target.R > 0;
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 网格列宽不会过渡。只在展开偏好翻转时按 200ms（--insight-chat-rail-motion）插值 R；拖动和窗口缩放仍立即落位。
    const motionMatches = railMotion !== null && railMotion.toExpanded === targetExpanded;
    const toggleStarted = last !== null && (last.R > 0) !== targetExpanded && railMotion === null;
    if ((motionMatches || toggleStarted) && !reduced) {
      if (!railMotion) {
        railMotion = { fromR: last!.R, toExpanded: targetExpanded, start: performance.now() };
      }
      const t = Math.min(1, (performance.now() - railMotion.start) / RAIL_MOTION_MS);
      const R = t >= 1 ? target.R : railMotion.fromR + (target.R - railMotion.fromR) * railMotionEase(t);
      const shown = geometryAtRail(input, R);
      const openWidth = railMotion.toExpanded ? target.R : railMotion.fromR;
      publish(shown, intent.rightVisible, !last || !geometryVarsEqual(last, shown), openWidth);
      if (t < 1) {
        if (!motionRaf) {
          motionRaf = requestAnimationFrame(() => {
            motionRaf = 0;
            applyNow();
          });
        }
      } else {
        railMotion = null;
      }
      return;
    }
    railMotion = null;
    if (motionRaf) cancelAnimationFrame(motionRaf);
    motionRaf = 0;
    publish(target, intent.rightVisible, !last || !geometryVarsEqual(last, target), target.R);
  }

  function scheduleGeometry(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      applyNow();
    });
  }

  const observer =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          scheduleGeometry();
        })
      : null;
  observer?.observe(host.shell);
  observer?.observe(host.primaryNav);
  observer?.observe(host.chromeControls);

  const onWindowResize = () => scheduleGeometry();
  window.addEventListener("resize", onWindowResize);

  applyNow();

  return {
    scheduleGeometry,
    applyNow,
    last: () => last,
    dispose() {
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      if (raf) cancelAnimationFrame(raf);
      if (motionRaf) cancelAnimationFrame(motionRaf);
      raf = 0;
      motionRaf = 0;
      railMotion = null;
    },
  };
}

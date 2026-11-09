import type { Oklch } from "./types";

export function normalizeHex(value: string): string {
  const text = String(value ?? "").trim();
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(text);
  if (!match) throw new Error("颜色必须是 3 位或 6 位 HEX。");
  const raw = match[1]!;
  return `#${(raw.length === 3 ? [...raw].map((part) => part + part).join("") : raw).toUpperCase()}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const toLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toSrgb = (v: number) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.sign(v) * Math.abs(v) ** (1 / 2.4) - 0.055;
function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function labFromLinear([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function linearFromLab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function srgbInGamut(linear: number[]): boolean { return linear.every((value) => value >= -1e-7 && value <= 1 + 1e-7); }

/** Maximum OKLCH chroma representable in sRGB for a lightness/hue pair. */
export function maxSrgbChroma(lightness: number, hue: number): number {
  const l = clamp(lightness, 0, 1);
  if (l <= 0 || l >= 1) return 0;
  const h = ((hue % 360) + 360) % 360;
  const radians = h * Math.PI / 180;
  const channels = (c: number) => linearFromLab(l, c * Math.cos(radians), c * Math.sin(radians));
  let low = 0, high = 0.5;
  if (srgbInGamut(channels(high))) return high;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    if (srgbInGamut(channels(mid))) low = mid; else high = mid;
  }
  return low;
}

export function hexToOklch(hex: string): Oklch {
  const [L, a, b] = labFromLinear(rgb(hex).map(toLinear) as [number, number, number]);
  return { l: L, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 };
}

export function oklchToHex(input: Oklch): { hex: string; mapped: boolean; input: Oklch } {
  if (![input.l, input.c, input.h].every(Number.isFinite)) throw new Error("OKLCH 必须是有限数值。");
  const color = { l: clamp(input.l, 0, 1), c: clamp(input.c, 0, 0.5), h: ((input.h % 360) + 360) % 360 };
  const channels = (c: number) => linearFromLab(color.l, c * Math.cos(color.h * Math.PI / 180), c * Math.sin(color.h * Math.PI / 180));
  let actualC = color.c;
  let linear = channels(actualC);
  const inGamut = srgbInGamut;
  const mapped = !inGamut(linear);
  if (mapped) {
    let low = 0, high = actualC;
    for (let i = 0; i < 28; i++) {
      const mid = (low + high) / 2;
      if (inGamut(channels(mid))) low = mid; else high = mid;
    }
    actualC = low;
    linear = channels(actualC);
  }
  const hex = `#${linear.map((v) => Math.round(clamp(toSrgb(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return { hex, mapped, input: { ...input } };
}

export function compositeHex(foreground: string, background: string, alpha: number): string {
  const fg = rgb(foreground), bg = rgb(background), a = clamp(Number.isFinite(alpha) ? alpha : 0, 0, 1);
  return `#${fg.map((v, i) => Math.round((v * a + bg[i]! * (1 - a)) * 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => rgb(hex).map(toLinear).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i]!, 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

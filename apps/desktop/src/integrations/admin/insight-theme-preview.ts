import { applyInsightThemePreviewLayer, clearInsightThemePreviewLayer, getActiveInsightPreviewOwner, restoreCurrentInsightAppearance } from "./insight-theme";
import type { ResolvedUiTheme } from "../../ui/color-system/theme-types";

let activeOwner: string | null = null;

export type ThemePreviewLease = Readonly<{ ownerId: string; release(): void }>;

/** The single temporary appearance writer; resolved theme variables contain colors only. */
export function acquireThemePreview(ownerId: string, resolved: ResolvedUiTheme): ThemePreviewLease {
  if (!ownerId.trim()) throw new Error("预览需要页面 owner。");
  if (activeOwner && activeOwner !== ownerId) throw new Error("另一个临时外观编辑器正在预览。");
  activeOwner = ownerId;
  applyInsightThemePreviewLayer(ownerId, resolved.cssVariables);
  return { ownerId, release: () => releaseThemePreview(ownerId) };
}

export function releaseThemePreview(ownerId?: string): void {
  if (!activeOwner || (ownerId && ownerId !== activeOwner)) return;
  const endingOwner = activeOwner;
  activeOwner = null;
  clearInsightThemePreviewLayer(endingOwner);
  restoreCurrentInsightAppearance();
}

function clearLeaseState(): void { activeOwner = null; }
if (typeof window !== "undefined") {
  window.addEventListener("orbita:insight-preview-ended", clearLeaseState);
  window.addEventListener("beforeunload", () => releaseThemePreview());
  window.addEventListener("orbita:data-dir-changed", () => releaseThemePreview());
}

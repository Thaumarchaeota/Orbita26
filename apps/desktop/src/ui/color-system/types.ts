export type Oklch = { l: number; c: number; h: number };
export type HexColor = `#${string}`;
export type CategoryRoles = {
  name: string;
  main: string;
  unfinishedBackground: string;
  unfinishedTitle: string;
  completed: string;
  completedBackground: string;
  /** Read path always fills these. Stored slots may omit them. */
  glowPrimary: string;
  glowSecondary: string;
  /** 0–1. Read path uses 0.5 when the stored value is absent. */
  glowPrimaryOpacity: number;
  glowSecondaryOpacity: number;
  mainForeground?: string;
  unfinishedForeground?: string;
  completedForeground?: string;
};
// Applied snapshots may predate the fifth role and the glow fields. Runtime read fills those gaps.
export type CategorySlot = Omit<CategoryRoles, "unfinishedTitle" | "glowPrimary" | "glowSecondary" | "glowPrimaryOpacity" | "glowSecondaryOpacity"> & {
  id: string;
  canonicalHex: string;
  unfinishedTitle?: string;
  glowPrimary?: string;
  glowSecondary?: string;
  glowPrimaryOpacity?: number;
  glowSecondaryOpacity?: number;
};
export type ColorCorrection = Partial<Pick<CategoryRoles, "main" | "unfinishedBackground" | "unfinishedTitle" | "completed" | "completedBackground" | "glowPrimary" | "glowSecondary">>;
export type CategoryDesignSlot = { id: string; name: string; canonicalHex?: string; base: Oklch; unfinishedBackground: Oklch; unfinishedTitle?: Oklch; completed: Oklch; completedBackground: Oklch; glowPrimary?: Oklch; glowSecondary?: Oklch; glowPrimaryOpacity?: number; glowSecondaryOpacity?: number; correction?: ColorCorrection };
export type ColorScheme = { id: string; name: string; slots: CategorySlot[]; designSlots?: CategoryDesignSlot[]; completion: { lightness: number; chroma: number; fillAlpha: number; borderAlpha: number }; corrections?: Record<string, ColorCorrection> };

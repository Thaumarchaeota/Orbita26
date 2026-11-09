import { resolveCategoryRoles, type CategoryRoles } from "../../../../ui/color-system";

export type ItemTypePalette = {
  name: string;
  main: string;
  unfinishedBackground: string;
  /** Legacy preset literals may omit the fifth display role; resolver output never does. */
  unfinishedTitle?: string;
  completed: string;
  completedBackground: string;
};

export const ITEM_TYPE_PALETTE: readonly ItemTypePalette[] = [
  { name: "红色", main: "#E44755", unfinishedBackground: "#FFE3E7", completed: "#C47E87", completedBackground: "#FFF0F2" },
  { name: "橙色", main: "#E87524", unfinishedBackground: "#FFE9D5", completed: "#C59370", completedBackground: "#FFF3E9" },
  { name: "金色", main: "#C59612", unfinishedBackground: "#FFF2BF", completed: "#AE9B61", completedBackground: "#FFF9E5" },
  { name: "绿色", main: "#28A65D", unfinishedBackground: "#DDF7E6", completed: "#78AC8B", completedBackground: "#EFFAF3" },
  { name: "青绿", main: "#12A594", unfinishedBackground: "#D5F7EF", completed: "#6DAFA3", completedBackground: "#EBFAF6" },
  { name: "天蓝", main: "#159DD1", unfinishedBackground: "#DBF3FF", completed: "#70AAC2", completedBackground: "#EEF9FF" },
  { name: "蓝色", main: "#4879ED", unfinishedBackground: "#E2ECFF", completed: "#879FD0", completedBackground: "#F0F5FF" },
  { name: "紫色", main: "#A052E0", unfinishedBackground: "#F0DFFF", completed: "#AE8BC9", completedBackground: "#F8EFFF" },
  { name: "玫瑰", main: "#DF4E99", unfinishedBackground: "#FFDFEF", completed: "#C686A8", completedBackground: "#FFF0F7" },
];

export function isItemTypeHex(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
}

export function itemTypePaletteFor(color: string | null | undefined): ItemTypePalette | undefined {
  if (!isItemTypeHex(color)) return undefined;
  return ITEM_TYPE_PALETTE.find((entry) => entry.main.toLowerCase() === color.toLowerCase());
}

// SPEC-0006 §8.1 keeps storage HEX canonical; this compatibility adapter only changes display roles.
export function itemTypeColorRoles(color: string): CategoryRoles {
  return resolveCategoryRoles(isItemTypeHex(color) ? color : "#87909a");
}

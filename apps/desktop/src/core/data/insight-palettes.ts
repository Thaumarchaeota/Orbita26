import type { InsightPalette } from "./types";

export type InsightPaletteId = `${number}`;

export type InsightPalettePreset = {
  id: InsightPaletteId;
  name: string;
  palette: InsightPalette;
};

const preset = (id: number, name: string, values: string[]): InsightPalettePreset => ({
  id: String(id) as InsightPaletteId,
  name,
  palette: {
    primary: values[0], selected: values[1], hover: values[2], chrome: values[3],
    sidebar: values[4], page: values[5], surface: values[6], controlSurface: values[7],
    sunken: values[8], textPrimary: values[9], textSecondary: values[10], border: values[11], danger: values[12],
  },
});

// Keep the 13-token order in one place: P/S/H, C/Sb/Pg/Sf/Ct/Sn, T1/T2/B/D.
export const INSIGHT_PALETTE_PRESETS: readonly InsightPalettePreset[] = [
  preset(1, "Fluent Air", ["#0F6CBD", "#DCEBFA", "#EAF3FB", "#EDF3F8", "#F3F6F9", "#FAFBFC", "#FFFFFF", "#FFFFFF", "#F1F4F6", "#242424", "#616161", "#D6DADF", "#C42B1C"]),
  preset(2, "Atlassian Mist", ["#0C66E4", "#E9F2FF", "#F1F6FD", "#F1F3F5", "#F6F7F9", "#FAFBFC", "#FFFFFF", "#FFFFFF", "#F2F4F7", "#172B4D", "#626F86", "#D7DCE2", "#C9372C"]),
  preset(3, "Carbon Clear", ["#0F62FE", "#E8F1FF", "#F2F6FC", "#F1F4F7", "#F5F7F9", "#F9FAFB", "#FFFFFF", "#FFFFFF", "#F0F2F4", "#161616", "#525252", "#D8D8D8", "#DA1E28"]),
  preset(4, "Spectrum Clean", ["#1269C7", "#E4F0FC", "#EFF6FC", "#F2F4F7", "#F6F7F9", "#FAFAFB", "#FFFFFF", "#FFFFFF", "#F3F4F6", "#292929", "#626262", "#D6D6D6", "#C9252D"]),
  preset(5, "Slate Pro", ["#315E8C", "#DFEAF4", "#EBF1F6", "#EAF0F5", "#F1F5F8", "#F8FAFB", "#FFFFFF", "#FFFFFF", "#EEF2F5", "#202A35", "#64717E", "#D2DAE1", "#C23B3F"]),
  preset(6, "Graphite Blue", ["#465F87", "#E1E8F2", "#EDF1F6", "#E8EDF3", "#EFF3F7", "#F7F9FB", "#FFFFFF", "#FFFFFF", "#ECEFF3", "#202631", "#666F7C", "#D1D7DF", "#C13E43"]),
  preset(7, "Indigo Work", ["#4959A8", "#E5E8F8", "#EFF1FA", "#EDEEF5", "#F3F4F8", "#FAFAFC", "#FFFFFF", "#FFFFFF", "#F0F0F5", "#25283A", "#696D80", "#D7D8E2", "#C43D46"]),
  preset(8, "Neutral Navy", ["#365A78", "#DEE9F0", "#EAF1F5", "#EAF0F3", "#F1F5F7", "#F8FAFB", "#FFFFFF", "#FFFFFF", "#EDF1F3", "#21303B", "#65737D", "#D3DBDF", "#BD3E42"]),
  preset(9, "Office Teal", ["#176B68", "#DDEDEA", "#EAF3F1", "#EAF1F0", "#F1F5F4", "#F8FAF9", "#FFFFFF", "#FFFFFF", "#EDF2F1", "#20312F", "#637572", "#D2DDDA", "#BE3C3C"]),
  preset(10, "Quiet Emerald", ["#276856", "#E0ECE7", "#ECF3F0", "#ECF1EF", "#F2F5F4", "#F9FAFA", "#FFFFFF", "#FFFFFF", "#EEF2F0", "#23312D", "#687570", "#D4DDD9", "#BF3F3F"]),
  preset(11, "Product Violet", ["#6656A3", "#EBE7F6", "#F3F0F8", "#F0EEF4", "#F5F3F7", "#FAF9FB", "#FFFFFF", "#FFFFFF", "#F2F0F4", "#2D2937", "#716C7C", "#DBD7E0", "#BF3D45"]),
  preset(12, "Soft Mauve", ["#725A7B", "#EDE6EF", "#F4EFF5", "#F0EDF1", "#F5F2F5", "#FAF9FA", "#FFFFFF", "#FFFFFF", "#F2EFF2", "#302A32", "#746D76", "#DCD7DC", "#BD4046"]),
  preset(13, "Warm Office", ["#755842", "#ECE5DF", "#F4EFEB", "#F1EDE9", "#F6F2EF", "#FAF9F7", "#FFFFFF", "#FFFFFF", "#F2EEEA", "#302A27", "#746C67", "#DDD6D0", "#B83F3B"]),
  preset(14, "Olive Utility", ["#5F6838", "#E8EADD", "#F1F2E9", "#EEF0E8", "#F4F5F0", "#FAFAF8", "#FFFFFF", "#FFFFFF", "#F1F2EC", "#2C3025", "#707467", "#DADDD3", "#B9443E"]),
  preset(15, "Steel Minimal", ["#4C6579", "#E1E9EE", "#ECF1F4", "#E9EEF1", "#F0F4F6", "#F8FAFA", "#FFFFFF", "#FFFFFF", "#EDF1F2", "#25313A", "#69757D", "#D4DBDF", "#BF4042"]),
  preset(16, "Porcelain Cobalt", ["#365D91", "#DFE7F3", "#EBF0F6", "#E8EDF2", "#F0F3F6", "#F8F9FA", "#FEFEFD", "#FFFFFF", "#ECEFF1", "#252B34", "#69717A", "#D2D8DE", "#BE4342"]),
  preset(17, "Celadon Ink", ["#386957", "#DFEBE5", "#ECF2EF", "#E8EFEB", "#F0F4F1", "#F8FAF8", "#FEFFFE", "#FFFFFF", "#ECF1ED", "#27322E", "#69766F", "#D1DBD5", "#BC4340"]),
  preset(18, "Dust Lilac", ["#665B91", "#E9E5F2", "#F2EFF7", "#EEEAF2", "#F4F1F5", "#FAF8FB", "#FFFDFE", "#FFFFFF", "#F1EDF2", "#302C38", "#736D7B", "#DBD6DF", "#BC4149"]),
  preset(19, "Sakura Graphite", ["#815565", "#F0E4E8", "#F7EEF1", "#F1E9EB", "#F6F1F2", "#FBF9F9", "#FFFDFD", "#FFFFFF", "#F3EDEF", "#342A2E", "#786B70", "#DED5D8", "#B93D45"]),
  preset(20, "Terracotta Paper", ["#934D3B", "#F3E3DE", "#F8EDE9", "#F2EAE6", "#F7F2EF", "#FBF9F7", "#FFFEFC", "#FFFFFF", "#F4EEEA", "#372B27", "#7B6D67", "#DFD5CF", "#B6383C"]),
  preset(21, "Glacier Cyan", ["#177184", "#DCECF0", "#E9F3F5", "#E7EFF1", "#EFF4F5", "#F8FAFA", "#FEFFFF", "#FFFFFF", "#EBF1F2", "#233237", "#65757A", "#CFDCDF", "#BD3F42"]),
  preset(22, "Midnight Iris", ["#514B84", "#E6E4F0", "#F0EEF6", "#EBEAF1", "#F2F1F5", "#F9F9FB", "#FFFFFF", "#FFFFFF", "#EEEFF3", "#29283A", "#6B6B7C", "#D6D5DF", "#BF4049"]),
  preset(23, "Eucalyptus", ["#476C5C", "#E2EBE6", "#EDF2EF", "#E9EEEB", "#F0F4F1", "#F8FAF8", "#FEFFFE", "#FFFFFF", "#EDF1EE", "#29322D", "#6C766F", "#D5DDD8", "#BC413E"]),
  preset(24, "Rainy Harbor", ["#426278", "#E1E9EE", "#ECF1F4", "#E7ECEF", "#EFF2F4", "#F7F9FA", "#FEFFFF", "#FFFFFF", "#EBEFF1", "#28323A", "#69757D", "#D2DADF", "#BD4144"]),
  preset(25, "Apricot Slate", ["#984C2C", "#F3E5DD", "#F8EEE8", "#EEEAE7", "#F5F1EE", "#FAF9F7", "#FFFDFC", "#FFFFFF", "#F1ECE8", "#342C28", "#776E68", "#DDD6D1", "#B63B3C"]),
  preset(26, "Mist Teal", ["#32696D", "#DFEAEA", "#ECF2F2", "#E8EEEE", "#F0F4F4", "#F8FAFA", "#FEFFFF", "#FFFFFF", "#ECF1F1", "#273233", "#697575", "#D1DBDB", "#BC4042"]),
  preset(27, "French Lavender", ["#5363A0", "#E5E8F4", "#EFF1F8", "#EAECF2", "#F1F2F6", "#F9F9FB", "#FFFFFF", "#FFFFFF", "#EEF0F4", "#292D3B", "#6D7180", "#D6D8E1", "#BE4048"]),
  preset(28, "Sage Blueprint", ["#536B5A", "#E4EAE5", "#EEF2EF", "#EAEEEB", "#F1F4F2", "#F9FAF9", "#FEFFFE", "#FFFFFF", "#EDF1EE", "#2C332E", "#707870", "#D6DDD7", "#BC413D"]),
  preset(29, "Rosewood Fog", ["#7D4F5A", "#EEE3E6", "#F5ECEE", "#EFE9EA", "#F5F0F1", "#FAF8F9", "#FFFDFE", "#FFFFFF", "#F2ECEE", "#332A2D", "#756A6E", "#DBD4D6", "#B93C44"]),
  preset(30, "Petrol Glass", ["#326477", "#DFE9ED", "#EBF1F3", "#E6ECEF", "#EEF3F4", "#F7F9F9", "#FDFFFF", "#FFFFFF", "#EAF0F1", "#263238", "#68767C", "#CFDADD", "#BD4042"]),
];

export function insightPalettePreset(id: string): InsightPalettePreset | undefined {
  return INSIGHT_PALETTE_PRESETS.find((item) => item.id === id);
}

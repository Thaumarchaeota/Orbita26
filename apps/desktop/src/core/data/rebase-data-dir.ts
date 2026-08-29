import type { AppSettings } from "./types";

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/$/, "");
}

function underDir(path: string, dir: string): boolean {
  const p = normPath(path.trim());
  if (!p) return true;
  const d = normPath(dir);
  return p === d || p.startsWith(`${d}/`);
}

export function patchForDataDirChange(
  current: AppSettings,
  newDataDir: string,
): Pick<AppSettings, "dataDir" | "integrations"> {
  const oldDir = current.dataDir;
  const integrations = { ...current.integrations };
  if (underDir(integrations.journal.dataRoot, oldDir)) {
    integrations.journal = { dataRoot: "" };
  }
  if (underDir(integrations.garmin.tokenDir, oldDir)) {
    integrations.garmin = { ...integrations.garmin, tokenDir: "" };
  }
  return { dataDir: newDataDir.trim(), integrations };
}

import { getSettings, patchSettings } from "../../core/settings";
import { defaultAiConfig } from "../../core/data/client";
import type { AiConfig, ApiEntry } from "../../core/data/types";

export type { AiConfig, ApiEntry };
export { defaultAiConfig };

let cached: AiConfig | null = null;

export async function loadAiConfig(): Promise<AiConfig> {
  cached = getSettings().ai;
  return cached;
}

export function getAiConfig(): AiConfig {
  if (!cached) throw new Error("ai config not loaded");
  return cached;
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  cached = config;
  await patchSettings({ ai: config });
}

export function getActiveEntry(config: AiConfig): ApiEntry | null {
  return config.entries.find((e) => e.id === config.activeEntryId) ?? config.entries[0] ?? null;
}

export async function initAiConfig(): Promise<AiConfig> {
  return loadAiConfig();
}

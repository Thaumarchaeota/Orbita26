import { invoke } from "@tauri-apps/api/core";
import { insightDomainWritesPaused } from "./host-guards";

export const INSIGHT_DOMAIN_WRITES_PAUSED_MESSAGE = "数据目录状态未确认，写入已暂停";

export function assertInsightDomainWritesAllowed(): void {
  if (insightDomainWritesPaused()) {
    throw new Error(INSIGHT_DOMAIN_WRITES_PAUSED_MESSAGE);
  }
}

export function invokeDomainWrite<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  assertInsightDomainWritesAllowed();
  return invoke<T>(cmd, args);
}

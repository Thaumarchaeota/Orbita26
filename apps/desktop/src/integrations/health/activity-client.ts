import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";

export type ActivityAssetSnapshot = {
  kind: string;
  status: string;
  relativePath: string | null;
  sha256: string | null;
  acquiredAt: string | null;
};

export type ActivityListItem = {
  id: string;
  revision: number;
  localDate: string;
  source: string;
  garminActivityId: string | null;
  startedAt: string;
  endedAt: string | null;
  typeKey: string | null;
  title: string | null;
  durationSeconds: number | null;
  elapsedDurationSeconds: number | null;
  movingDurationSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  avgHeartRateBpm: number | null;
  avgSpeedMps: number | null;
  avgPaceSecondsPerKm: number | null;
  avgPowerWatts: number | null;
  calories: number | null;
  detailStatus: string | null;
  suspectedDuplicateOf: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivitiesListResponse = {
  activities: ActivityListItem[];
};

export type ActivityDetailResponse = {
  activity: ActivityListItem;
  assets: ActivityAssetSnapshot[];
};

export type ReadActivityAssetResponse = {
  kind: string;
  relativePath: string;
  sha256: string;
  bytesBase64: string;
};

export type ListActivitiesQuery = {
  localDateFrom?: string | null;
  localDateTo?: string | null;
  limit?: number;
  offset?: number;
};

export async function healthListActivities(
  query: ListActivitiesQuery = {},
): Promise<ActivitiesListResponse> {
  return invoke<ActivitiesListResponse>("health_list_activities", { req: query });
}

export async function healthGetActivity(id: string): Promise<ActivityDetailResponse> {
  return invoke<ActivityDetailResponse>("health_get_activity", { req: { id } });
}

export async function healthReadActivityAsset(
  activityId: string,
  kind: string,
): Promise<ReadActivityAssetResponse> {
  return invoke<ReadActivityAssetResponse>("health_read_activity_asset", {
    req: { activityId, kind },
  });
}

export async function healthRetryActivityOriginal(activityId: string): Promise<void> {
  await invokeDomainWrite<void>("health_retry_activity_original", { req: { activityId } });
}

export async function healthExportActivityFit(
  activityId: string,
  outputPath: string,
): Promise<void> {
  await invoke<void>("health_export_activity_fit", {
    req: { activityId, outputPath },
  });
}

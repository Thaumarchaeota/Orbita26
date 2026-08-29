import { detailItemForApi, getActiveCommitItems } from "./detail-item-api";
import type { CommitPayload, DetailItem, Entry } from "../types";
import { cloneDetailItems, cloneEntries } from "../utils";

export { cloneEntries, cloneDetailItems };

export function stripMarkers(entries: Entry[]): Entry[] {
  return cloneEntries(entries).map((e) => {
    const copy = { ...e };
    delete copy._is_new;
    delete copy._deleted;
    return copy;
  });
}

export function buildCommitPayload(
  items: DetailItem[],
  validationToken: string,
  candidateHash: string,
): CommitPayload {
  return {
    items: getActiveCommitItems(items).map(detailItemForApi),
    validation_token: validationToken,
    candidate_hash: candidateHash,
  };
}

export function buildValidatePayload(items: DetailItem[]): {
  items: ReturnType<typeof detailItemForApi>[];
} {
  return { items: getActiveCommitItems(items).map(detailItemForApi) };
}

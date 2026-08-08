import { entryForApi, isActiveEntry } from "./entry";
import type { CommitPayload, Entry } from "../types";
import { cloneEntries } from "../utils";

export { cloneEntries };

export function stripMarkers(entries: Entry[]): Entry[] {
  return cloneEntries(entries).map((e) => {
    const copy = { ...e };
    delete copy._is_new;
    delete copy._deleted;
    return copy;
  });
}

export function getDirtyActiveEntries(entries: Entry[]): Entry[] {
  return entries.filter(isActiveEntry);
}

export function buildCommitPayload(writeTarget: string, entries: Entry[]): CommitPayload {
  return {
    files: {
      [writeTarget]: getDirtyActiveEntries(entries).map(entryForApi),
    },
  };
}

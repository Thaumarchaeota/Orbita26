import { invoke } from "@tauri-apps/api/core";
import { invokeDomainWrite } from "../admin/domain-write-guard";

export type JournalEntrySnapshot = {
  id: string;
  revision: number;
  kind: string;
  title?: string | null;
  startedAt: string;
  endedAt?: string | null;
  mood?: string | null;
  text?: string | null;
  summary?: string | null;
  markdown?: string | null;
  hasDetail: boolean;
  detailFileId?: string | null;
  detailSha256?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type EntryResponse = { entry: JournalEntrySnapshot };
export type EntriesListResponse = { entries: JournalEntrySnapshot[] };

const NOTE_DRAFT_PREFIX = "new-note:";
const DOC_DRAFT_PREFIX = "new-doc:";

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function newJournalDraftId(kind: "note" | "document"): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return kind === "note" ? `${NOTE_DRAFT_PREFIX}${uuid}` : `${DOC_DRAFT_PREFIX}${uuid}`;
}

export function parseJournalTabId(id: string): {
  isDraft: boolean;
  kind: "note" | "document" | null;
  id: string;
} {
  if (id.startsWith(NOTE_DRAFT_PREFIX)) {
    return { isDraft: true, kind: "note", id };
  }
  if (id.startsWith(DOC_DRAFT_PREFIX)) {
    return { isDraft: true, kind: "document", id };
  }
  return { isDraft: false, kind: null, id };
}

export function journalTabTitle(
  kind: "note" | "document",
  title: string,
  text: string,
): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  if (kind === "note") {
    const line = text.trim().split(/\r?\n/)[0]?.trim();
    if (line) return line.length > 40 ? `${line.slice(0, 40)}…` : line;
    return "新随记";
  }
  return "新文档";
}

export function journalArchiveCreateNote(req: {
  startedAt: string;
  text: string;
  title?: string;
  endedAt?: string;
  mood?: string;
}) {
  return invokeDomainWrite<EntryResponse>("journal_archive_create_note", { req });
}

export function journalArchiveUpdateNote(req: {
  id: string;
  expectedRevision: number;
  title?: string | null;
  text?: string;
  startedAt?: string;
  endedAt?: string | null;
  mood?: string | null;
}) {
  return invokeDomainWrite<EntryResponse>("journal_archive_update_note", { req });
}

export function journalArchiveCreateDocument(req: {
  title: string;
  startedAt: string;
  summary?: string;
  mood?: string;
  endedAt?: string;
  markdown?: string;
}) {
  return invokeDomainWrite<EntryResponse>("journal_archive_create_document", { req });
}

export function journalArchiveSaveDocument(req: {
  id: string;
  expectedRevision: number;
  title?: string;
  summary?: string | null;
  mood?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  markdown?: string;
}) {
  return invokeDomainWrite<EntryResponse>("journal_archive_save_document", { req });
}

export function journalArchiveConvertNoteToDocument(req: {
  id: string;
  expectedRevision: number;
  title: string;
  summary?: string;
  mood?: string | null;
  endedAt?: string | null;
}) {
  return invokeDomainWrite<EntryResponse>("journal_archive_convert_note_to_document", { req });
}

export function journalArchiveDeleteEntry(req: { id: string; expectedRevision: number }) {
  return invokeDomainWrite<EntryResponse>("journal_archive_delete_entry", { req });
}

export function journalArchiveGetEntry(id: string) {
  return invoke<EntryResponse>("journal_archive_get_entry", { req: { id } });
}

export function journalArchiveListEntries(req: { includeDeleted?: boolean; limit?: number } = {}) {
  return invoke<EntriesListResponse>("journal_archive_list_entries", { req });
}

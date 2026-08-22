import type { CandidateDiagnostic, ValidateError } from "../types";

export type ValidationErrorLike = ValidateError | CandidateDiagnostic;

export function resolveValidationFocusEntryId(error: ValidationErrorLike): string | null {
  if ("entry_id" in error) {
    return error.entry_id || null;
  }
  return error.item_ids?.[0] ?? null;
}

export function collectValidationMarkedEntryIds(errors: ValidationErrorLike[]): string[] {
  const ids = new Set<string>();
  for (const err of errors) {
    if ("entry_id" in err) {
      if (err.entry_id) ids.add(err.entry_id);
      continue;
    }
    for (const id of err.item_ids ?? []) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export function collectGlobalValidationMessages(errors: ValidationErrorLike[]): string[] {
  const messages: string[] = [];
  for (const err of errors) {
    if ("entry_id" in err) continue;
    if ((err.item_ids?.length ?? 0) > 0) continue;
    if (err.message) messages.push(err.message);
  }
  return messages;
}

export function groupValidationErrorsByItemId(
  errors: CandidateDiagnostic[],
): Map<string, CandidateDiagnostic[]> {
  const grouped = new Map<string, CandidateDiagnostic[]>();
  for (const err of errors) {
    for (const id of err.item_ids ?? []) {
      if (!id) continue;
      const list = grouped.get(id) ?? [];
      list.push(err);
      grouped.set(id, list);
    }
  }
  return grouped;
}

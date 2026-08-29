# Journal note is a first-class manual record

- Status: Accepted
- Date: 2026-08-29

## Context

After meals are assigned to Orbita Health, the initial Orbita Journal contains events and moods. An `event` is a compact statement of something that occurred; it is not an adequate substitute for a personal written reflection.

## Decision

Add a first-class manual Orbita Journal record type, shown to users as **随记**. It has a required business date, optional occurrence time, optional title and required body. It is independently addressable and supports normal create, edit, soft delete, undo, search and future synchronization.

It is not a `daily` container field, a Health fact, an AI conclusion, or a general-purpose attachment/knowledge system. Events and moods remain separate structured Journal record types.

## Consequences

- Journal has a clear primary record for longer personal expression without distorting event semantics.
- The Journal list can search titles and bodies while retaining date-based review.
- Later tags, attachments, links and AI-derived summaries require their own decisions; they are not implied by the new record type.

## Alternatives considered

1. Put arbitrary long text in `event.remark`: rejected because it blurs an event's concise, time-oriented meaning.
2. Add a free-text field to `daily`: rejected because it recreates a mixed date container rather than an independently manageable fact.
3. Make every Journal item a generic note: rejected because moods and events retain useful structured behavior.

## Open questions

- Whether the initial editor exposes a title or derives a list title from the body.
- Whether a note's optional time should affect ordering among events and moods.
- Whether tags are needed before a real archive retrieval use case exists.

# Journal / Health keeps professional facts with a shared sync envelope

- Status: Accepted
- Date: 2026-08-30

## Context

The old Journal JSON made `daily` and `routine` simultaneously date containers, Garmin import targets and editable manual records. A single generic record table with opaque JSON would improve shared CRUD mechanics, but would preserve ambiguous ownership and make Health time-series, meals and future synchronization hard to validate.

## Decision

The v0.0.18 SQLite target stores Journal and Health as professional, independently addressable facts: Garmin daily metrics and metric-day snapshots; sleep/naps; meals; activities; body measurements; events; moods; and notes. `daily` and `routine` become query projections, not mutable mixed-source documents.

Every synchronizable fact has a shared envelope: stable UUID, source, revision, creation/update timestamps and tombstone state. Outbox operations share an idempotent operation envelope. This common envelope does not turn the domain records into a universal Event or require one opaque data blob.

## Consequences

- Garmin facts and manual facts can coexist without merge-by-overwrite rules; Garmin remains read-only.
- A manual Meal, Nap, Activity, Event, Mood or Note can be revised, deleted and synchronized on its own lifecycle.
- High-density Garmin samples move as a metric-day snapshot, avoiding per-sample outbox operations.
- The implementation needs explicit schema, repositories and projection queries instead of a mechanical JSON-to-SQLite copy.

## Alternatives considered

1. Retain `daily` / `routine` as SQLite JSON containers: rejected because it keeps mixed ownership and overwrite risk.
2. Use one generic `records` table with all business fields in `data`: rejected because it hides source-specific constraints and time-series semantics.
3. Separate Journal and Health SQLite files immediately: deferred; one `{journalRoot}/journal.sqlite` keeps current transactional boundaries simple without erasing domain boundaries.

## Open questions

- The exact schema and migration mechanism, to be audited before implementation.
- The server conflict policy and tombstone retention policy.
- Whether future domains need the same envelope without sharing Journal / Health tables.

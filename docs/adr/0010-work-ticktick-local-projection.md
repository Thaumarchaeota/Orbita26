# TickTick Work uses a local confirmed projection

- Status: Proposed
- Date: 2026-08-31

## Context

The desktop application currently calls Dida/TickTick directly and keeps project and task data only in UI memory. It cannot show the last confirmed task state after restart or reliably place Work records on an Orbita timeline while offline.

TickTick remains the external authority for Work tasks. Users will continue to create and edit tasks in the TickTick desktop/mobile/web applications; those are expected external changes and must be reconciled into Orbita's projection. A local copy must not become an unconstrained second task authority. The prohibited dual-writer case is Orbita's desktop integration and Orbita's server broker both calling the TickTick API concurrently during migration.

## Decision

Orbita Work will keep a local SQLite **confirmed Work projection** for TickTick projects and tasks. The projection is the source for offline display and Timeline read models, and it stores only states confirmed by TickTick (or, after the broker migration, confirmed by the Orbita server's TickTick connector).

Mutations will be represented separately as durable Work commands. A command is not a confirmed task fact; its lifecycle must remain visible until it is confirmed, rejected, conflicted, or requires manual confirmation. The detailed command routing and authority transition remain open.

## Consequences

- Timeline can read stable, locally stored Work facts without calling TickTick directly.
- The projection needs stable provider-scoped project/task identifiers, a content hash or provider version, observed time, and clear handling for deleted or unavailable external objects.
- Offline operations require a durable command queue and reconciliation, rather than optimistic mutation of the confirmed projection.
- The future direct-desktop to server-broker cutover must preserve one **Orbita-owned** TickTick API writer at a time; it does not and must not block normal TickTick-app edits.

## Alternatives considered

1. Keep tasks only in memory and fetch TickTick for every Timeline view: rejected because it fails offline/restart use cases and makes the Timeline depend on a live provider.
2. Treat the local Work database as a second independently writable task authority: rejected because it conflicts with TickTick authority and makes reconciliation unsafe.

## Open questions

- Whether the desktop writes commands directly to TickTick before broker migration, or all writes first enter a local command queue.
- The exact sync path between the desktop projection/command queue and the future server broker.
- Which Work times become Timeline events: due/start, completion, creation, or all of them.
- Retention, tombstone, restore and external-deletion behavior for projected tasks.

# Finance multi-replica record coordination keeps local `.bean` ledgers writable

- Status: Proposed
- Date: 2026-08-31

## Context

Orbita Finance currently keeps `{dataDir}/bill` as a local Beancount ledger and writes it only through Finance Candidate / Commit. Transactions may carry an `orbita-id` metadata identifier, but the current Parser / Commit is a restricted, whole-file renderer: it does not provide lossless preservation or safe multi-device merge for every valid Beancount construct.

The product requires every authorized Orbita client to keep a complete, locally writable `.bean` ledger, work while offline, and continue to permit deliberate editor-based ledger work. The NAS must coordinate replicas without receiving, mounting, copying, or writing a `.bean` file.

## Decision

Finance becomes an independent `finance/v1` record-sync protocol. Each `{dataDir}/bill` remains a locally writable Finance ledger and is a separate replica. The NAS is the synchronization coordinator for managed records: it stores current versions, immutable history, operation receipts, conflicts and cursors, but never stores or materializes a `.bean` file.

The first synchronized record type is a managed transaction with an immutable `orbita-id`. An individual transaction has two distinct representations:

- a **canonical semantic snapshot** used for identity, version comparison, search and safe UI editing; and
- a **lossless directive block** used to preserve text and supported/unknown syntax during local materialization.

No device may obtain a remote transaction and then use the current whole-file renderer to rewrite arbitrary ledger text. Finance sync requires a lossless directive index/materializer before it can enable a ledger. Unsupported directives and unrecognized transaction constructs remain local opaque blocks until a later protocol explicitly supports them; they must not be silently regenerated, merged or deleted.

## Architecture

```text
each client
  local .bean ledger ── Parser / local Commit ── lossless directive materializer
          │                              │
          └──────── finance-sync.sqlite ─┼── push / pull / ACK ── NAS coordinator
                                         │                         current / history / conflicts
                                         └── local outbox / jobs
```

`{dataDir}/bill/.orbita/finance-sync.sqlite` is not a second ledger. It holds only coordination state:

- `replica_state`: replica identity, account binding, protocol version and bootstrap state;
- `record_shadow`: each managed record's last materialized server version, canonical hash and directive location;
- `outbox` / delivery state: frozen operations, retries and receipts;
- `inbox`, cursor and applied-operation dedupe;
- `materialization_jobs`: pre/post ledger manifest hashes and crash-recovery state;
- conflicts and explicit resolution records.

Every managed operation includes an `op_id`, `record_id`, `base_server_version`, local revision, canonical hash, complete snapshot or tombstone, origin replica and timestamp. The NAS accepts a matching base version, deduplicates equal content, and preserves unequal concurrent changes as a conflict. It never uses last-writer-wins or delete-wins.

## Local commit, pull and recovery

1. A local UI, CSV import or approved AI action first creates a durable materialization job with its expected pre/post ledger manifest and a frozen outbox operation.
2. Local Candidate / Commit writes the ledger; Parser and the lossless index re-read it and verify the same `orbita-id` and canonical hash.
3. The coordination database records the new local baseline and makes the operation eligible for push. A network failure never rolls back the locally committed `.bean` change.
4. A pulled remote operation first creates an inbox/job entry. The local lossless materializer applies it only if the expected manifest still matches. Parser verification must succeed before the client advances its cursor and ACKs delivery.
5. After a crash, the job's pre/post manifest determines whether the ledger write did not occur, did occur and needs its outbox reconstructed, or drifted externally. Drift isolates that replica rather than guessing.

An editor-based ledger change is never uploaded by file watcher alone. The client re-parses and indexes it; valid, uniquely identified managed transaction changes are shown as a reconciliation diff and require user confirmation before creating an operation. A missing transaction is not automatically interpreted as delete. Missing/duplicate IDs, parse failure, opaque-block changes, unknown directive changes or manifest mismatch stop sync and preserve both sides for manual reconciliation.

## Initial bootstrap

The existing PC ledger is the one and only initial seed. Before any remote data is accepted, the PC performs a capability audit, backs up the local ledger, explicitly backfills and verifies unique `orbita-id` values for managed transactions, then uploads one fixed seed checkpoint of canonical records and baseline hashes. The NAS records an immutable `seed_id` and cursor; it rejects a second full seed for that account.

A joining device starts with no Finance directory. It first authenticates and obtains the seed checkpoint, then creates its local bill root and materializes the checkpoint before it may write or push. A device with a pre-existing non-identical ledger is not allowed to join automatically: it produces a comparison report and requires manual reconciliation or a clean re-bootstrap.

The joining device also needs a safe bootstrap source for account/category structure and opaque ledger blocks that are deliberately outside the first record-sync allowlist. The NAS must never run or mutate these files, but the exact protected bootstrap-artifact policy remains open because it determines whether a new device can initialize without an unsafe partial ledger.

## Scope and safety defaults

- `finance/v1` initially synchronizes only `transaction` records with stable `orbita-id`; identical transactions with different IDs are distinct.
- Amounts and commodity/cost values are exact strings, never JSON floating-point values. Posting and metadata order are semantic and included in canonical hashing.
- The first enabled ledger must pass a lossless-capability audit. Existing IDs are backfilled only through an explicit, backed-up migration.
- Cross-year movement is a single record update; file path and source line are materialization locations, never identity.
- `delete` creates a tombstone; `restore` is an explicit versioned operation with a complete snapshot. Edit/delete/restore races create conflicts.
- Conflict resolution offers keep-local, take-remote, manually resolve, or copy-as-new-ID. It produces an auditable `resolve` operation.
- `account.bean`, `category.bean`, settings, imports, `pad`, `balance`, `open`, commodities, plugins, includes, comments and opaque directive blocks are not Finance v1 records. Their manifest hashes are checked before materialization; a mismatch blocks affected writes rather than being overwritten.
- Finance logs, metrics and support bundles contain only redacted replica/op hashes, versions, cursors, file-manifest hashes and error codes. They must not expose transaction content, amounts, account names or ledger text.

## Consequences

- Offline edits commit locally and can later conflict; “saved locally” and “synchronized across replicas” are distinct user-visible states.
- The NAS is authoritative only for the synchronization history/current version of managed records, while each device retains its own local ledger file and local Commit boundary.
- The protocol reuses common sync mechanics—device identity, `op_id` idempotency, optimistic concurrency, push/pull/ACK, history, conflicts and diagnostics—but cannot reuse `journal-health/v1` schemas or its SQLite apply path.
- `services/sync` needs a separate `contracts/finance/v1` and contract registry. Its current Finance rejection is correct until that independent protocol and the lossless local materializer exist.
- The current Finance renderer cannot be used as the synchronization materializer for opaque or unsupported syntax. A ledger that fails the capability audit remains local-only rather than risking destructive synchronization.

## Alternatives considered

1. NAS as the sole `.bean` materializer: rejected for this product direction because it removes independent offline `.bean` editing and requires the NAS to fully and losslessly understand all supported user ledger syntax.
2. Synchronize or merge `.bean` files directly: rejected because file-level diff/merge cannot safely distinguish transaction identity, concurrent edits, reordering, metadata and semantic ledger conflicts.
3. Let all replicas overwrite their ledgers and use last-writer-wins: rejected because it can silently lose financial records.
4. Treat the current whole-file Parser / Commit renderer as lossless: rejected because it normalizes/reorders text and has known unsupported syntax boundaries.

## Open questions

- Is a lossless directive index/materializer an acceptable prerequisite before any Finance sync release, rather than attempting a narrow but destructive shortcut?
- What protected bootstrap artifact may provide the empty device with account/category structure and opaque ledger blocks without making the NAS a normal `.bean` writer or continuous file-sync endpoint?
- Which currently opaque directives should become first-class synchronized records after transactions: account/category structure, commodity prices, balance assertions, or another limited set?
- What maximum offline window, tombstone/history retention, backup ownership and recovery target apply to financial data?

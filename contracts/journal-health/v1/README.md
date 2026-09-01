# journal-health/v1

Versioned wire contract for Orbita Journal and Health fact synchronization between desktop, Android, and `services/sync`.

## Scope

Synchronizable **professional facts** only:

| `recordType` | Domain | Natural key |
| --- | --- | --- |
| `daily_metrics` | `health` | `localDate` + `source` |
| `metric_day_snapshot` | `health` | `localDate` + `metricName` + `source` + `coverage` + `contentHash` |
| `sleep_night` | `health` | `wakeDate` + `source` |
| `nap` | `health` | `localDate` + `source` + `externalKey` (Garmin) or `id` (manual) |
| `meal` | `health` | `id` |
| `activity` | `health` | `externalId` (Garmin) or `id` (manual) |
| `body_measurement` | `health` | `localDate` + `source` + `contentHash` |
| `event` | `journal` | `id` |
| `mood` | `journal` | `id` |
| `note` | `journal` | `id` |

## Out of scope

See [`excluded-domains.json`](excluded-domains.json). Query projections (`daily`, `routine`), trend caches, app state, SQLite files, Finance, raw FIT, and tokens are never transmitted on this protocol.

## Files

| Path | Purpose |
| --- | --- |
| [`sync-envelope.json`](sync-envelope.json) | `SyncOperation`, `SyncChange`, `SyncResult`, `SyncError` |
| [`schemas/`](schemas/) | Per-type snapshot JSON Schemas |
| [`errors.json`](errors.json) | Error codes and client/server compatibility |
| [`compatibility-matrix.json`](compatibility-matrix.json) | Version negotiation |
| [`canonical/`](canonical/) | Canonical JSON and content-hash rules |
| [`test-vectors/canonical-hashes.json`](test-vectors/canonical-hashes.json) | Cross-language hash fixtures |
| [`fixtures/`](fixtures/) | Sanitized snapshot examples |

## Conventions

- JSON wire format uses **camelCase** (`localDate`, `metricName`, `externalId`, `createdAtUtc`, …).
- Calendar dates are `YYYY-MM-DD` in **Asia/Shanghai**.
- Timestamps are RFC 3339 UTC strings with second precision (`2026-01-15T08:00:00Z`).
- `source` is `manual` or `garmin`. Garmin facts are read-only on non-collector devices.
- Every fact carries a shared envelope: stable UUID `id`, monotonic `revision`, `createdAtUtc`, `updatedAtUtc`, optional `deletedAtUtc` tombstone.
- Content hashes use canonical JSON rules in [`canonical/canonical-rules.md`](canonical/canonical-rules.md).

## Validation

```bash
python contracts/tools/validate-fixtures.py
```

Rust validator: see [`contracts/tools/README.md`](../../tools/README.md).

# orbita-sync architecture

Standalone Linux API service for Orbita Journal/Health record-level sync. Clients keep independent SQLite replicas; this service stores current projections, immutable history, conflicts, and cursors.

## Modules

```text
services/sync/src/
├── api/routes.rs      # REST handlers (push, pull, enroll, revoke, health, metrics)
├── auth/              # Bearer token hash verification, enrollment, capabilities, IDOR guards
├── canonical.rs       # Sorted-key canonical JSON + SHA-256 content_hash
├── config.rs          # Env-based config; secrets referenced by file path only
├── db/                # SQLite schema, migrations + file lock, repository transactions
├── health.rs          # /health/live, /health/ready
├── metrics.rs         # Prometheus-style counters
├── redaction.rs       # Structured log redaction
├── retention.rs       # Single retention worker skeleton
└── sync/engine.rs     # Push/pull core: dedupe, conflict, op_id idempotency
```

## Data model

Server SQLite (WAL, foreign keys) holds:

| Table | Purpose |
| --- | --- |
| `accounts`, `devices`, `device_tokens`, `device_capabilities` | Identity; tokens stored as hashes only |
| `enrollment_invites` | One-time hashed invite codes with expiry |
| `current_records` | Authoritative per-entity projection |
| `record_versions` | Immutable version history |
| `operations` | `op_id` receipt store for idempotent push |
| `conflicts` | Preserved branches when base mismatches with different content |
| `client_checkpoints` | Per-device pull cursor |
| `schema_migrations` | Applied migration versions |

## Sync semantics

1. **Contract gate** — `contract_version` must be `journal-health/v1`; `schema_version` must match server.
2. **Finance hard reject** — `domain=finance` returns `rejected` per v1 scope.
3. **base_server_version** — Required match for conditional writes; mismatch + different `content_hash` → `conflict` (not LWW).
4. **Dedupe** — Same canonical `content_hash` on stale base is `deduplicated`.
5. **op_id** — Stored receipt; replays return the same result.
6. **change_seq** — Account-scoped monotonic cursor for pull pagination.
7. **Account scope** — Always from auth session, never from request body.

## HTTP surface

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/health/live` | none |
| GET | `/health/ready` | none |
| GET | `/metrics` | none |
| POST | `/v1/sync/push` | Bearer device token |
| POST | `/v1/sync/pull` | Bearer device token |
| POST | `/v1/devices/enroll` | invite code |
| POST | `/v1/devices/revoke` | Bearer (own device) |
| POST | `/v1/admin/invites` | bootstrap (gate in production) |

Default listen: `127.0.0.1:8787`.

## Configuration

| Variable | Default |
| --- | --- |
| `ORBITA_SYNC_LISTEN_ADDR` | `127.0.0.1:8787` |
| `ORBITA_SYNC_STATE_DIR` | `./state` |
| `ORBITA_SYNC_BACKUP_DIR` | `./backup` |
| `ORBITA_SYNC_LOG_LEVEL` | `info` |
| `ORBITA_SYNC_SECRET_TOKEN_PEPPER_FILE` | optional path |
| `ORBITA_SYNC_SECRET_ENROLLMENT_PEPPER_FILE` | optional path |

## Deployment notes

- Single migration leader via `migration.lock` file.
- Retention worker runs as one background task; compaction policy TBD.
- Ready probe checks DB, migration version, disk placeholder, backup freshness placeholder.

See [api-examples.md](api-examples.md) for request/response samples.

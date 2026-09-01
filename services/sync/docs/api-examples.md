# API examples

Base URL: `http://127.0.0.1:8787`

## Health

```http
GET /health/live
```

```json
{"status":"ok"}
```

```http
GET /health/ready
```

```json
{
  "status": "ok",
  "migration_version": 1,
  "db_ok": true,
  "disk_ok": true,
  "backup_fresh": true
}
```

## Create enrollment invite (bootstrap)

```http
POST /v1/admin/invites
Content-Type: application/json

{
  "account_id": "acc-001",
  "ttl_hours": 24
}
```

```json
{
  "invite_code": "550e8400-e29b-41d4-a716-446655440000",
  "expires_at_utc": "2026-08-31T10:00:00.000Z"
}
```

## Enroll device

```http
POST /v1/devices/enroll
Content-Type: application/json

{
  "invite_code": "550e8400-e29b-41d4-a716-446655440000",
  "device_label": "desktop-pc"
}
```

```json
{
  "device_id": "dev-abc",
  "token": "secret-device-token-uuid"
}
```

## Push operations

```http
POST /v1/sync/push
Authorization: Bearer secret-device-token-uuid
Content-Type: application/json

{
  "contract_version": "journal-health/v1",
  "schema_version": 1,
  "operations": [
    {
      "op_id": "op-001",
      "domain": "journal",
      "record_type": "mood",
      "record_id": "rec-001",
      "kind": "upsert",
      "base_server_version": null,
      "content_hash": "abc123...",
      "snapshot": {
        "id": "rec-001",
        "source": "manual",
        "local_date": "2026-08-30",
        "value": 4
      },
      "origin": "manual"
    }
  ]
}
```

```json
{
  "results": [
    {
      "op_id": "op-001",
      "status": "accepted",
      "server_version": 1,
      "change_seq": 1,
      "conflict_id": null
    }
  ],
  "head_change_seq": 1
}
```

### Conflict response

```json
{
  "op_id": "op-002",
  "status": "conflict",
  "server_version": 1,
  "change_seq": 1,
  "conflict_id": "conflict-uuid"
}
```

### Finance rejected

```json
{
  "op_id": "op-003",
  "status": "rejected",
  "message": "finance domain not supported in v1"
}
```

## Pull changes

```http
POST /v1/sync/pull
Authorization: Bearer secret-device-token-uuid
Content-Type: application/json

{
  "contract_version": "journal-health/v1",
  "schema_version": 1,
  "cursor": 0,
  "limit": 100
}
```

```json
{
  "changes": [
    {
      "domain": "journal",
      "record_type": "mood",
      "record_id": "rec-001",
      "server_version": 1,
      "content_hash": "abc123...",
      "snapshot": { "id": "rec-001", "source": "manual", "value": 4 },
      "is_tombstone": false,
      "change_seq": 1
    }
  ],
  "next_cursor": 1,
  "has_more": false
}
```

## Revoke device

```http
POST /v1/devices/revoke
Authorization: Bearer secret-device-token-uuid
Content-Type: application/json

{
  "device_id": "dev-abc"
}
```

```json
{
  "device_id": "dev-abc",
  "revoked": true
}
```

## Metrics

```http
GET /metrics
```

Prometheus text format counters for push, pull, conflicts, dedupe, errors, backup age.

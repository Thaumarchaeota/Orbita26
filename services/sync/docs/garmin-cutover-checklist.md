# Garmin Cutover Checklist

## State machine

```text
desktop_collector_active → drain → server_observe → server_active → desktop_pull_only
```

## Pre-cutover

- [ ] Sync S0 complete; Garmin natural keys stable per type
- [ ] Single desktop holds `garmin_collect` capability
- [ ] Server connector code deployed (mock → real wiring later)
- [ ] Encrypted credential vault ready (no desktop token copy)
- [ ] Rollback plan documented and owner approved

## Drain phase

- [ ] Stop new desktop fetches
- [ ] ACK all Garmin outbox to final watermark
- [ ] Record `last_success_window_end`

## Observe phase

- [ ] Server fetches overlap window (read-only ingest)
- [ ] Reconcile by external_id + content_hash per type
- [ ] Any type without stable natural key: exclude from cutover

## Activate

- [ ] Transition to `server_active`
- [ ] Revoke desktop `garmin_collect` capability
- [ ] Desktop enters `desktop_pull_only`
- [ ] Verify no parallel imports (audit log)

## Rollback triggers

- Hash mismatch above threshold
- Missing external keys for required types
- 429 storm / credential invalid

## Rollback procedure

1. Stop server writer
2. Record server cursor and pending windows
3. Transition to `desktop_collector_active`
4. Re-grant `garmin_collect` to one desktop only

# Restore Runbook

## When to restore

- Corrupted database after verified integrity_check failure
- Failed migration with rollback unsupported
- Disaster recovery per confirmed RPO/RTO

## Procedure

1. **Stop service**: `systemctl stop orbita-sync.service`
2. **Preserve evidence**: copy current `server.sqlite` and WAL to quarantine path
3. **Select backup**: choose latest backup passing verifier
4. **Isolated restore**:
   ```bash
   docker compose -f /srv/app/orbita-sync/deploy/docker-compose.yml --profile backup run --rm --no-deps \
     --entrypoint /usr/local/bin/orbita-sync-tools orbita-sync-backup restore \
     --backup /data/backup/server-YYYYMMDDTHHMMSSZ.sqlite \
     --target /data/state/server-restored.sqlite
   ```
5. **Verify**:
   - `PRAGMA integrity_check` = ok
   - `schema_migrations` version matches release manifest
   - Table counts match pre-incident baseline
   - Sample cursor/conflict row counts
6. **Swap**: with the API still stopped, have the maintenance operator atomically rename the verified restored file to `server.sqlite`; never overwrite a running database.
7. **Start service** and verify `/readyz`
8. **Client re-bootstrap**: devices with cursor beyond restored point must re-pull

## Verification checklist

- [ ] current record count
- [ ] history row count
- [ ] conflict queue state
- [ ] client checkpoint max cursor
- [ ] connector metadata (Garmin/TickTick phase)
- [ ] canonical hash spot-check (no content in logs)

## Rollback of restore

If restored DB fails verification, revert to quarantined copy. Do not merge partial restores.

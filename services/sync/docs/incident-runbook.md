# Incident Runbook

## Support diagnostics access

The operation timeline and support-bundle endpoints are intentionally unavailable
to ordinary `sync` device tokens. They require a separately issued
`support_diagnostics` capability and an explicit operation id; exports contain
only allowlisted operational facts, never account, device, correlation, record,
or payload identifiers. The enrollment/administration path for issuing that
capability is a deployment prerequisite, not a client feature.

## Severity levels

| Level | Examples | Response |
| --- | --- | --- |
| S1 | Data loss risk, auth bypass | Stop ingress, preserve state, notify owner |
| S2 | Sync stalled, backup stale | Investigate metrics, no destructive action |
| S3 | Connector degraded | Isolate connector, Journal/Health sync continues |

## Common incidents

### API unreachable via Tailscale

1. Check `tailscaled` and Serve config
2. Verify container: `docker compose ps`
3. Check bind on `127.0.0.1:8787`
4. Review recent deploy changes

### Database lock / high latency

1. Confirm single worker (no second instance)
2. Check disk space on state volume
3. Review WAL size and backup timer status
4. Do not copy live WAL files

### Auth failures spike

1. Check for revoked devices
2. Verify token hash migration not in progress
3. Review rate-limit metrics
4. Do not log raw tokens

### Connector 429 / cooldown

1. Verify `cooldown_until` in connector state
2. Do not trigger SSO or desktop token migration
3. Confirm single writer per connector phase
4. See connector-specific cutover checklists

## Escalation data to collect

- Request correlation IDs (redacted)
- Migration version
- Backup age
- Connector phase per account
- Error codes only (no payloads)

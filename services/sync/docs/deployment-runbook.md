# Deployment Runbook

## Prerequisites

- Debian host with Docker, Tailscale, and dedicated NVMe paths for state and backup
- Tailscale ACL restricting access to approved devices
- Config at `/etc/orbita-sync/config.toml` (mode `0600`)

## Initial deploy

1. Build image from `deploy/Dockerfile`
2. Copy `deploy/config.example.toml` to `/etc/orbita-sync/config.toml` and fill placeholders
3. Configure Tailscale Serve using `deploy/tailscale-serve.example.json`
4. Install systemd units from `deploy/systemd/`; the backup unit invokes the Compose backup profile, not a host binary.
5. Start: `systemctl enable --now orbita-sync.service`
6. Enable backup timer: `systemctl enable --now orbita-sync-backup.timer`
7. Verify `curl -k https://<tailnet-host>/healthz` and `/readyz`

## Network constraints

- API binds `127.0.0.1:8787` only
- External access via Tailscale Serve HTTPS only
- No public LAN or WAN port exposure

## Post-deploy checks

- [ ] Migration version matches release manifest
- [ ] Backup timer active and first timestamped `server-*.sqlite` backup completed
- [ ] Device enrollment invite flow works
- [ ] Logs contain no payload content (see redaction tests)

## Rollback

1. `systemctl stop orbita-sync.service`
2. Restore from latest verified backup (see restore-runbook.md)
3. Re-deploy previous image digest from release manifest

# Release Checklist

## Pre-release

- [ ] All tests pass: `cargo test` in `services/sync/`
- [ ] Protocol simulator scenarios green
- [ ] Backup/restore verifier green
- [ ] Redaction tests green
- [ ] Migration round-trip tested
- [ ] SBOM generated from `deploy/sbom.template.json`
- [ ] Release manifest filled (`deploy/release-manifest.template.yaml`)
- [ ] Image digest recorded
- [ ] Contract version compatibility verified

## Build

- [ ] Docker image built non-root, read-only rootfs
- [ ] `orbita-sync-tools` binary included
- [ ] No secrets in image layers or env defaults

## Deploy

- [ ] Config reviewed (`deploy/config.example.toml` baseline)
- [ ] Tailscale Serve config applied
- [ ] systemd units installed
- [ ] Backup timer enabled
- [ ] healthz/readyz pass

## Post-release

- [ ] First scheduled backup succeeded
- [ ] Smoke test: device push/pull
- [ ] Monitor error rate for 24h
- [ ] Document version in ops log

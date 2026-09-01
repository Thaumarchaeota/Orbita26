# Canonical JSON and content hashes

This directory defines how Orbita computes **content hashes** for journal-health/v1 snapshots. All platforms (desktop Rust, Android, Python, `services/sync`) must produce identical SHA-256 digests for the same logical payload.

## Quick reference

1. Select the **hash input object** per record type (see [`canonical-rules.md`](canonical-rules.md)).
2. Serialize with **sorted object keys**, **no insignificant whitespace**, UTF-8 encoding.
3. Compute **SHA-256** over the UTF-8 bytes; emit lowercase hex (64 characters).

## Test vectors

Cross-language fixtures live in [`../test-vectors/canonical-hashes.json`](../test-vectors/canonical-hashes.json). Implementations must pass all vectors before claiming contract compliance.

## Relationship to wire format

- Envelope fields (`id`, `revision`, `createdAtUtc`, `fetchedAt`, …) are **not** included in content hashes unless explicitly listed for a type.
- `contentHash` on the wire is always the digest of the canonical payload object, never the full snapshot envelope.
- `naturalKey` is derived from envelope + payload fields for deduplication; it is not hashed separately.

## Desktop alignment note

Current desktop `content_hash` uses `serde_json::to_string` without key sorting. New sync paths must adopt these canonical rules; existing local hashes may differ until migration.

# Contract validation tools

## Python (`validate-fixtures.py`)

Validates all `journal-health/v1/fixtures/` against per-type JSON Schemas and checks `contentHash` against canonical rules. Also verifies `test-vectors/canonical-hashes.json`.

```bash
python contracts/tools/validate-fixtures.py
```

Uses `jsonschema` when installed; falls back to structural and hash checks otherwise.

## Rust

Contract conformance tests live in `services/sync/tests/contract_conformance.rs`. They load `contracts/journal-health/v1/test-vectors/` and fixtures via path relative to the sync crate.

```bash
cd services/sync && cargo test contract_conformance
```

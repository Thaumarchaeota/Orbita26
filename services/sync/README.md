# orbita-sync

Future independently deployed Linux API service. Clients keep local SQLite replicas; this service handles versioned sync API only.

## Layout

```text
services/sync/
├── src/connectors/garmin/   # provider port, DTOs, cutover state machine
├── src/connectors/ticktick/ # OAuth model, command outbox, broker state machine
├── connectors/garmin/fixtures/
├── src/tools/               # backup, restore, migration lock
├── deploy/                  # Docker, Compose, systemd, config templates
├── tests/                   # protocol simulator, fuzz/migration/conformance skeletons
└── docs/                    # deployment, incident, restore, cutover runbooks
```

## Build & test

```bash
cd services/sync
cargo test
cargo build --bin orbita-sync-tools
```

## Library exports

```rust
use orbita_sync::garmin::{GarminProvider, CutoverPhase, MockGarminProvider};
use orbita_sync::ticktick::{WorkCommand, BrokerPhase, MockTickTickProvider};
use orbita_sync::tools::{online_backup, isolated_restore, MigrationLock};
```

No real Garmin/TickTick API calls. No deployment execution. No desktop token migration.

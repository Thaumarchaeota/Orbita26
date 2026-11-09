# Desktop SQLite dependency conflict fixture

Independent, deliberately unresolvable workspace. This preserves desktop's exact
rusqlite 0.32.1 with bundled/backup and PowerSync SDK 0.1.1's default rusqlite
0.39 dependency. It does not import Tauri or change the application.

Only the coordinator may run commands, after checking shared process ownership.
From this directory, `cargo metadata --format-version 1` should fail during
dependency resolution. Do not use `--no-deps`: that skips the graph being tested.
Capture the full diagnostic and exit code in ignored `local-results/`.

Accept the expected failure only when the diagnostic identifies both dependency
chains, `libsqlite3-sys` 0.30.1 versus 0.37.x, and the conflicting native
`links = "sqlite3"` restriction. Network failure, an unavailable package/cache,
an invalid manifest, or a tool failure is **not** confirmation. No compilation
is necessary. There is intentionally no pre-generated lock for an impossible
graph. An offline attempt is meaningful only if all required index metadata is
already cached.

## Recorded coordinator result

The coordinator ran `cargo metadata --offline --format-version 1` from this
fixture directory. It exited 1 with the expected native `links = "sqlite3"`
conflict: desktop's `libsqlite3-sys` 0.30.1 versus the SDK path's 0.37.0, with
both dependency chains identified. This was the intended resolution failure,
not an unavailable-package or network failure. No compilation was needed.

This confirms that the two pinned default dependency paths cannot coexist
unchanged. It does not reject PowerSync itself or a reviewed desktop upgrade,
and does not establish a production adapter. The implementor did not execute
commands; the result above was supplied by the coordinator.

# Desktop connection conversion negative fixture

Independent workspace with exact desktop rusqlite 0.32.1 and PowerSync SDK
0.1.1 with `default-features = false`. Only the coordinator may execute it,
after checking process ownership and supplying the locally scoped native build
dependencies described by the parent probe. No Tauri graph is imported.

From this directory, the proposed check is `cargo check --jobs 1`. Capture the
exit code and complete diagnostic in ignored `local-results/`. After an initial
successful dependency fetch/lock creation, use `--locked --offline` when the
entire graph is cached. The fixture intentionally fails to compile.

Accept the expected failure only for the call to `single_connection(conn)` in
this fixture: an E0277 conversion/trait-bound diagnostic showing that the
desktop `rusqlite::Connection` does not implement the required conversion into
the SDK's internal `SqliteConnection`. Missing libclang, missing runtime
features, unresolved packages, network errors, or unrelated compiler errors
are **not** confirmation. This check needs native dependency compilation and
must not be started while another session owns the build resources.

Pinned SDK source also shows `db` and its `connection` module are private;
raw connection constructors are not a public safe escape hatch. Public
`ConnectionPool::open(path)` opens new connections and does not transfer the
existing coordinator-owned connection. This fixture neither uses unsafe
handles nor relaxes the single-owner requirement.

## Recorded coordinator result

The coordinator ran `cargo check --offline --jobs 1` from this fixture
directory. Dependency compilation completed, then the check exited 1 with
exactly one E0277 at `single_connection(conn)`: the existing desktop
`rusqlite::Connection` cannot convert into the SDK's internal
`SqliteConnection`. There were no other compilation errors in that run.
Resolution generated a 174-package `Cargo.lock`, which is retained.

This is the intended API failure, not a missing-build-dependency or cache
failure. Disabling the SDK default feature therefore does not provide the
tested zero-change safe connection handoff. It does not evaluate an SDK fork,
a reviewed desktop upgrade or a production adapter. The implementor did not
execute commands; the result above was supplied by the coordinator.

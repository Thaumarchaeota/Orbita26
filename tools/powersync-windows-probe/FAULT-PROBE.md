# Synthetic process-crash and SQLite capacity probe

`src/bin/fault_probe.rs` is a separate opt-in binary. Existing library/main
behavior is unchanged. The coordinator has executed this local fault probe and
the two negative dependency fixtures; exact observed scope is recorded below.
The implementor did not run commands.

Only the coordinator may run it after checking current dev/build ownership.
Use the parent probe's pinned Cargo.lock and process-local x64 libclang setup.
The entry point from this probe's directory is:

```powershell
cargo run --bin fault_probe --locked --offline --jobs 1
```

The offline command requires all locked dependencies cached. Do not run the
default binary or the old test suite as a substitute for this new entry point.
There is no network connect call, server, shell child or descendant process.
The reqwest client supplies the offline SDK interface only.

Each of the three stages gets a fresh UUID directory immediately under the
canonical OS temporary directory. Marker, subject/oracle SQLite files, frozen
oracle JSON and status files use exclusive creation. Artifacts remain after
success and failure; nothing deletes, clears or recursively removes anything.
No external database path, dataDir, credential or endpoint is accepted. The
child accepts only a canonical lowercase v4 UUID and one of three stage names;
it derives its temp directory and verifies the exact UUID/stage marker,
ordinary files and directory identity before opening the reserved subject.

Before spawning the child, the parent seeds four linked synthetic domain rows,
locally completes that preparation-only SDK group, and backs up the baseline
to an independent oracle database. This local completion does not represent
server acceptance. It performs the intended transaction on the oracle, checks
all candidate data/old values/metadata/base and SDK grouping, and syncs the
full expected snapshot to `oracle.json`. The child cannot supply or rewrite
the expected result. Recovery compares full row contents, context metadata,
all raw SDK queue rows and public SDK transaction fields including IDs, and
all five quarantine columns; it also runs SQLite integrity_check.

| Forced-stop stage | Required recovered state |
| --- | --- |
| beforecommit | Exact baseline; no candidate domain changes, metadata, queue or rescue |
| aftercommit | All four updated domain rows and one complete pending SDK group; no rescue |
| afterquarantine-beforecomplete | Full committed domain/group plus exact five-column durable rescue; pending group still present |

The child syncs `ready.txt` containing UUID/stage, then creates an empty
sync-completion flag. The parent waits at most 30 seconds for readiness, checks for an
early child exit, and fails on early exit, mismatched ready markers or timeout.
It force-stops and waits only its directly owned Child. RAII also kills/waits
that Child on errors, and reports cleanup failures. SQLite is reopened only
after a successful explicit wait. The child keeps the beforecommit lease and
SQL transaction alive until the force-stop; normal destructor rollback cannot
stand in for that stage. Directory sync and host hardware durability are not
claimed. Filesystem/SQLite calls and OS process wait are synchronous; the
readiness deadline is cooperative, not an operating-system I/O hard timeout.

A fourth independent database tests SQLite's local capacity ceiling. After
schema and baseline setup, max_page_count is set to current page_count plus
exactly 16 headroom pages and read back. The transaction's context and all four
domain updates must first succeed. On that same connection, the probe checks
all four complete candidate rows/revisions, context metadata/base and all four
raw SDK CRUD entries including grouping, new/old values and metadata. Only then
does a single pressure statement attempt a zeroblob larger than the entire
capped database capacity and no larger than 32 MiB. Only that statement's actual
SQLite DiskFull error code passes. Early FULL or any other preparation failure
is a failed experiment, with no retries or cap adjustment. The precise current
statement, completed-update count, candidate verification, pressure attempt,
error and rollback status are retained in `diskfull-progress.json`.
The probe records the autocommit state, rolls back if still
active, and compares the complete baseline including queue/rescue contents.
It restores only this connection's capacity ceiling and successfully performs
writes plus COMMIT on the same connection, then rechecks full baseline equality.
The blob request is capped at 32 MiB and max_page_count prevents actual disk
filling. This is not an experiment that exhausts the host drive.

## Recorded coordinator result

The first real compilation failed with two E0716 errors: temporary mutation
strings were borrowed across `await` in oracle preparation and recovery.
Both sites were changed to hold a local mutation string. Independent targeted
static review checked that correction. After confirming the previous process
tree had exited, the coordinator ran
`cargo run --bin fault_probe --locked --offline --jobs 1` again. This second
invocation compiled in 14.98 seconds and exited 0.

| Local experiment | Observed result |
| --- | --- |
| beforecommit force-stop | PASS: recovered complete baseline matched the independent pre-crash oracle; no new candidate group |
| aftercommit force-stop | PASS: full committed domain/context and complete pending SDK group matched the oracle |
| afterquarantine-beforecomplete force-stop | PASS: full pending group plus all five durable quarantine columns matched the oracle |
| Bounded SQLite FULL | PASS: all four candidate rows and raw CRUD entries were verified before the pressure statement returned actual SQLite DiskFull; full baseline remained unchanged and the same connection accepted subsequent writes and COMMIT |

The capacity experiment observed page_count 36, max_page_count readback 52,
page_size 4096 and fixed headroom 16 pages. Its recorded
`fullCandidateAndFourRawCrudRowsVerifiedBeforePressure` was true and
`autocommitAfterError` was true: SQLite had already rolled back the failed
transaction, so an additional rollback was unnecessary. These are this run's
observations, not general guarantees for every failure mode.

All temporary synthetic evidence directories were retained. The coordinator
confirmed this probe's processes had been reaped. No additional run was made
to update this documentation. The two desktop negative fixtures separately
confirmed the default native-link conflict and the no-default safe-conversion
API failure; their own README files retain the exact commands and outcomes.

These are process-crash and bounded SQLite failure observations. They do not
test host power loss, filesystem/device failures, real server rejection, old
service backup restoration, network loss/ACK retry, long offline retention,
Android lifecycle or production integration. A passing run must not mark those
unexecuted layers complete. The successful local run does not complete the
whole C gate or prove a production desktop adapter. Preserve the original
command/output and retained evidence alongside the existing validation plan.

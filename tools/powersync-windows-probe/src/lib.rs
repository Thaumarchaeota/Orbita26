//! Isolated synthetic evidence only; see docs/plans/powersync-windows-isolated-validation.md.
//! Nothing here establishes a production model, wire contract or server acceptance policy.
use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, time::{Duration, Instant}};

use anyhow::{Context, Result, bail, ensure};
use powersync::{ConnectionPool, CrudTransaction, PowerSyncDatabase,
    env::PowerSyncEnvironment, schema::{RawTable, RawTableSchema, Schema}};
use rusqlite::{Connection, OpenFlags, backup::{Backup, StepResult}, params};
use serde_json::{Value, json};

const TABLES: [&str; 4] = ["probe_project", "probe_task", "probe_action", "probe_interval"];
const REJECTION_REASON: &str = "synthetic permanent rejection; not server accepted";
type QuarantineRow = (String, String, String, String, String);
type FrozenGroup = (String, String, String);

struct RecoveryExpected {
    quarantine: Vec<QuarantineRow>,
    pending: FrozenGroup,
}

fn backup_bounded(source: &Connection, dest: &mut Connection) -> Result<()> {
    let backup = Backup::new(source, dest)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    for _ in 0..500 {
        ensure!(Instant::now() < deadline, "backup step deadline exceeded");
        if matches!(backup.step(5)?, StepResult::Done) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    bail!("backup step limit exceeded")
}

/// Retained on success AND failure. No Drop cleanup or recursive deletion.
struct Evidence {
    dir: PathBuf,
}

impl Evidence {
    fn create() -> Result<Self> {
        let dir = std::env::temp_dir().join(format!("Orbita-PowerSync-合成-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).context("create unique synthetic directory")?;
        let mut marker = OpenOptions::new().write(true).create_new(true).open(dir.join("SYNTHETIC-ONLY.txt"))?;
        marker.write_all(b"Synthetic PowerSync probe. Retain for inspection; no user data.\n")?;
        marker.sync_all()?;
        println!("Evidence directory (retained): {}", dir.display());
        Ok(Self { dir })
    }

    fn reserve(&self, name: &str) -> Result<PathBuf> {
        ensure!(!name.contains(['/', '\\']) && !name.starts_with('.'), "internal filename required");
        let path = self.dir.join(name);
        OpenOptions::new().write(true).create_new(true).open(&path)?.sync_all()?;
        Ok(path)
    }
}

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;")?;
    ensure!(conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))? == "wal", "WAL not active");
    ensure!(conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))? == 2, "FULL not active");
    ensure!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))? == 1, "FK not active");
    Ok(())
}

fn open_owned(path: &Path) -> Result<Connection> {
    // Only reserved paths created by this run reach here; no caller-supplied paths.
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    configure(&conn)?;
    Ok(conn)
}

fn raw_schema() -> Schema {
    Schema { tables: vec![], raw_tables: TABLES.into_iter()
        .map(|name| RawTable::with_schema(name, RawTableSchema::default())).collect() }
}

fn database(conn: Connection) -> (PowerSyncDatabase, ConnectionPool) {
    let pool = ConnectionPool::single_connection(conn);
    let env = PowerSyncEnvironment::custom(reqwest::Client::new(), pool.clone(), PowerSyncEnvironment::tokio());
    (PowerSyncDatabase::new(env, raw_schema()), pool)
}

async fn setup(db: &PowerSyncDatabase) -> Result<()> {
    let conn = db.writer().await?;
    conn.execute_batch("
      CREATE TABLE probe_context (singleton INTEGER PRIMARY KEY CHECK(singleton=1), metadata TEXT NOT NULL);
      CREATE TABLE probe_project (id TEXT PRIMARY KEY, root_id TEXT, value TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE probe_task (id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES probe_project(id) DEFERRABLE INITIALLY DEFERRED, value TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE probe_action (id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES probe_project(id) DEFERRABLE INITIALLY DEFERRED, value TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE probe_interval (id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES probe_action(id) DEFERRABLE INITIALLY DEFERRED, value TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE probe_quarantine (mutation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, base TEXT NOT NULL, reason TEXT NOT NULL);
    ")?;
    for table in TABLES {
        // Explicit raw-table triggers exercise the documented virtual-table API.
        // Context is written in the SAME transaction; no pairing of two FIFO queues.
        conn.execute_batch(&format!("
          CREATE TRIGGER {table}_insert AFTER INSERT ON {table} BEGIN
            INSERT INTO powersync_crud(op,id,type,data,metadata)
            VALUES('PUT',NEW.id,'{table}',json_object('root_id',NEW.root_id,'value',NEW.value,'revision',NEW.revision),
              (SELECT metadata FROM probe_context WHERE singleton=1));
          END;
          CREATE TRIGGER {table}_update AFTER UPDATE ON {table} BEGIN
            INSERT INTO powersync_crud(op,id,type,data,old_values,metadata)
            VALUES('PATCH',NEW.id,'{table}',json_object('root_id',NEW.root_id,'value',NEW.value,'revision',NEW.revision),
              json_object('root_id',OLD.root_id,'value',OLD.value,'revision',OLD.revision),
              (SELECT metadata FROM probe_context WHERE singleton=1));
          END;
        "))?;
    }
    Ok(())
}

fn metadata(mutation: &str, base: i64) -> String {
    json!({"mutationId":mutation,"groupId":mutation,"base":{"project":base,"action":base},
        "command":"synthetic-group","protocol":"probe-only"}).to_string()
}

fn set_context(conn: &Connection, mutation: &str, base: i64) -> Result<()> {
    conn.execute("INSERT INTO probe_context VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET metadata=excluded.metadata", [metadata(mutation, base)])?;
    Ok(())
}

fn counts(conn: &Connection) -> Result<Vec<i64>> {
    TABLES.into_iter().chain(["ps_crud", "probe_quarantine"])
        .map(|table| Ok(conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?)).collect()
}

async fn g1(db: &PowerSyncDatabase, evidence: &Evidence) -> Result<()> {
    let conn = db.writer().await?;
    configure(&conn)?;
    let version: String = conn.query_row("SELECT sqlite_version()", [], |r| r.get(0))?;
    let core: String = conn.query_row("SELECT powersync_rs_version()", [], |r| r.get(0))?;
    println!("G1 SQLite={version}; PowerSync core={core}; WAL=wal; synchronous=2(FULL)");
    let path = evidence.reserve("g1-backup.sqlite")?;
    let mut dest = open_owned(&path)?;
    backup_bounded(&conn, &mut dest)?;
    ensure!(dest.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? == "ok", "backup integrity");
    ensure!(counts(&conn)? == counts(&dest)?, "backup row counts differ");
    println!("G1 PASS: static extension initialized, Unicode path, FULL/WAL and synthetic backup API");
    Ok(())
}

async fn g2(db: &PowerSyncDatabase, mutation: &str) -> Result<()> {
    {
        let conn = db.writer().await?;
        let tx = conn.unchecked_transaction()?;
        set_context(&tx, mutation, 0)?;
        // Children before parents deliberately exercise deferred commit validation.
        tx.execute("INSERT INTO probe_interval VALUES('i','a','closed',1)", [])?;
        tx.execute("INSERT INTO probe_task VALUES('t','p','task',1)", [])?;
        tx.execute("INSERT INTO probe_action VALUES('a','p','action',1)", [])?;
        tx.execute("INSERT INTO probe_project VALUES('p',NULL,'project',1)", [])?;
        tx.commit()?;
        let before = counts(&conn)?;
        {
            let tx = conn.unchecked_transaction()?;
            set_context(&tx, "rollback-mutation", 1)?;
            tx.execute("INSERT INTO probe_project VALUES('rolled',NULL,'rollback',1)", [])?;
            tx.rollback()?;
        }
        ensure!(counts(&conn)? == before, "explicit rollback changed rows/queue");
        // Real SQLite COMMIT failure, not a pre-commit synthetic error.
        conn.execute_batch("BEGIN")?;
        set_context(&conn, "failed-commit", 1)?;
        conn.execute("INSERT INTO probe_project VALUES('half',NULL,'must-rollback',1)", [])?;
        conn.execute("INSERT INTO probe_task VALUES('orphan','missing','must-rollback',1)", [])?;
        let commit = conn.execute_batch("COMMIT");
        ensure!(commit.is_err(), "deferred FK COMMIT unexpectedly succeeded");
        ensure!(!conn.is_autocommit(), "expected failed commit to retain transaction");
        conn.execute_batch("ROLLBACK")?;
        ensure!(conn.is_autocommit() && counts(&conn)? == before, "failed COMMIT left partial state");
        conn.execute_batch("BEGIN; SELECT 1; COMMIT;")?;
    }
    let tx = db.next_crud_transaction().await?.context("SDK queue missing committed group")?;
    ensure!(tx.id.is_some() && tx.crud.len() == 4, "SDK transaction split/missing rows");
    for entry in &tx.crud {
        ensure!(entry.transaction_id == tx.id.unwrap(), "mixed SDK transaction ids");
        let meta: Value = serde_json::from_str(entry.metadata.as_deref().context("missing metadata")?)?;
        ensure!(meta["mutationId"] == mutation && meta["base"]["project"] == 0, "metadata/base lost");
    }
    let mut actual: Vec<_> = tx.crud.iter().map(|entry| entry.table.as_str()).collect();
    actual.sort_unstable();
    let mut expected = TABLES.to_vec(); expected.sort_unstable();
    ensure!(actual == expected, "wrong root/member table set");
    println!("G2 PASS: real SDK four-table CrudTransaction + metadata; rollback/failed COMMIT preserve all counts");
    Ok(())
}

async fn g3(db: &PowerSyncDatabase) -> Result<()> {
    let conn = db.writer().await?;
    conn.execute_batch("
      CREATE TABLE immediate_parent(id TEXT PRIMARY KEY);
      CREATE TABLE immediate_child(id TEXT PRIMARY KEY,parent TEXT REFERENCES immediate_parent(id));
      CREATE TABLE unique_names(id TEXT PRIMARY KEY,name TEXT UNIQUE);
      INSERT INTO unique_names VALUES('1','alpha'),('2','beta');
      BEGIN;
    ")?;
    ensure!(conn.execute("INSERT INTO immediate_child VALUES('c','later')", []).is_err(), "immediate FK order counterexample missing");
    conn.execute_batch("ROLLBACK; BEGIN;")?;
    ensure!(conn.execute("UPDATE unique_names SET name='beta' WHERE id='1'", []).is_err(), "UNIQUE swap counterexample missing");
    conn.execute_batch("ROLLBACK")?;
    println!("G3 SQL-ONLY: immediate FK child-first and UNIQUE name-swap fail; deferred FK succeeds in G2.");
    println!("G3 NOT TESTED: SDK download apply, echo suppression, checkpoints and server transaction grouping (no public offline apply used).");
    Ok(())
}

fn frozen(tx: &CrudTransaction<'_>) -> Result<FrozenGroup> {
    let first = tx.crud.first().context("empty group")?;
    let meta: Value = serde_json::from_str(first.metadata.as_deref().context("missing group metadata")?)?;
    let id = meta["mutationId"].as_str().context("missing mutation identity")?.to_owned();
    let base = meta["base"].to_string();
    let entries: Vec<Value> = tx.crud.iter().map(|entry| json!({
        "clientId":entry.client_id,"transactionId":entry.transaction_id,
        "table":entry.table,"id":entry.id,"operation":entry.update_type,
        "data":entry.data,"previousValues":entry.previous_values,"metadata":entry.metadata
    })).collect();
    for entry in &tx.crud {
        let other: Value = serde_json::from_str(entry.metadata.as_deref().context("entry lacks metadata")?)?;
        ensure!(other == meta, "group has inconsistent metadata");
    }
    Ok((id, json!({"transactionId":tx.id,"lastItemId":tx.last_item_id,"metadata":meta,"entries":entries}).to_string(), base))
}

fn quarantine_rows(conn: &Connection) -> Result<Vec<QuarantineRow>> {
    let mut stmt = conn.prepare("SELECT mutation_id,fingerprint,payload,base,reason FROM probe_quarantine ORDER BY mutation_id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    let collected = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(collected)
}

fn preserve(conn: &Connection, id: &str, payload: &str, base: &str, reason: &str) -> Result<()> {
    // Exact frozen-byte equality is the probe fingerprint. No unstable default hasher;
    // this is not a proposed production canonical hash contract.
    let tx = conn.unchecked_transaction()?;
    tx.execute("INSERT INTO probe_quarantine VALUES(?1,?2,?2,?3,?4) ON CONFLICT(mutation_id) DO NOTHING", params![id,payload,base,reason])?;
    let stored: (String,String,String,String) = tx.query_row(
        "SELECT fingerprint,payload,base,reason FROM probe_quarantine WHERE mutation_id=?1", [id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
    ensure!(stored == (payload.into(),payload.into(),base.into(),reason.into()), "mutation ID reused with different frozen content");
    tx.commit()?;
    Ok(())
}

async fn complete_if_preserved(db: &PowerSyncDatabase, tx: CrudTransaction<'_>) -> Result<String> {
    let (id, payload, base) = frozen(&tx)?;
    {
        let writer = db.writer().await?;
        // Fail closed: never complete unless durable local rescue matches this group.
        let matches: i64 = writer.query_row("SELECT count(*) FROM probe_quarantine WHERE mutation_id=?1 AND fingerprint=?2 AND payload=?2 AND base=?3 AND reason=?4", params![id,payload,base,REJECTION_REASON], |r|r.get(0))?;
        ensure!(matches == 1, "quarantine missing; dequeue forbidden");
    }
    // SDK complete is only queue removal; the independent rescue above survives it.
    tx.complete().await?;
    Ok(id)
}

async fn quarantine_then_complete(db: &PowerSyncDatabase) -> Result<String> {
    let tx = db.next_crud_transaction().await?.context("expected pending transaction")?;
    let (id, payload, base) = frozen(&tx)?;
    {
        let writer = db.writer().await?;
        configure(&writer)?;
        preserve(&writer, &id, &payload, &base, REJECTION_REASON)?;
        let before_rows = quarantine_rows(&writer)?;
        let before_counts = counts(&writer)?;
        preserve(&writer, &id, &payload, &base, REJECTION_REASON)?;
        ensure!(preserve(&writer, &id, &(payload.clone()+" "), &base, REJECTION_REASON).is_err(), "same ID/different payload accepted");
        ensure!(quarantine_rows(&writer)? == before_rows && counts(&writer)? == before_counts,
            "duplicate/mismatched payload changed rescue records or queue counts");
    }
    let reread = db.next_crud_transaction().await?.context("mismatch check lost pending group")?;
    ensure!(frozen(&reread)? == (id,payload,base), "mismatch check changed queued payload");
    drop(reread);
    complete_if_preserved(db, tx).await
}

async fn g4(db: &PowerSyncDatabase, mutation: &str) -> Result<RecoveryExpected> {
    ensure!(quarantine_then_complete(db).await? == mutation, "wrong rescued group");
    ensure!(db.next_crud_transaction().await?.is_none(), "completed group remains queued");
    {
        let writer = db.writer().await?;
        let tx = writer.unchecked_transaction()?;
        set_context(&tx, "second-stable-group", 1)?;
        tx.execute("UPDATE probe_project SET value='project-edited',revision=2 WHERE id='p'", [])?;
        tx.execute("UPDATE probe_task SET value='task-edited',revision=2 WHERE id='t'", [])?;
        tx.commit()?;
    }
    {
        let tx = db.next_crud_transaction().await?.context("missing second transaction")?;
        ensure!(tx.crud.len()==2, "second group incomplete");
        ensure!(tx.crud.iter().all(|entry|entry.previous_values.as_ref().is_some_and(|old|old["revision"]==1)), "raw trigger previous values lost");
    }
    quarantine_then_complete(db).await?;
    {
        let writer = db.writer().await?;
        let tx = writer.unchecked_transaction()?;
        set_context(&tx, "third-stable-pending", 2)?;
        tx.execute("UPDATE probe_project SET value='pending-project',revision=3 WHERE id='p'", [])?;
        tx.execute("UPDATE probe_task SET value='pending-task',revision=3 WHERE id='t'", [])?;
        tx.commit()?;
    }
    let pending = db.next_crud_transaction().await?.context("third pending group missing")?;
    ensure!(pending.crud.len() == 2, "third pending group incomplete");
    let frozen_pending = frozen(&pending)?;
    let before_counts = { let writer=db.writer().await?; counts(&writer)? };
    ensure!(complete_if_preserved(db, pending).await.is_err(), "unquarantined pending group dequeued");
    let after = db.next_crud_transaction().await?.context("negative guard lost pending group")?;
    ensure!(frozen(&after)? == frozen_pending, "negative guard changed pending content");
    drop(after);
    let writer = db.writer().await?;
    ensure!(counts(&writer)? == before_counts, "negative guard changed row/queue counts");
    let quarantine = quarantine_rows(&writer)?;
    ensure!(quarantine.len() == 2, "expected exactly two preserved groups");
    println!("G4 PASS (local policy): two complete rescues, immutable ID/content guard, and third real pending group refuses completion without rescue");
    Ok(RecoveryExpected { quarantine, pending: frozen_pending })
}

async fn g5(db: &PowerSyncDatabase, pool: &ConnectionPool) -> Result<()> {
    let lease = pool.writer().await;
    ensure!(tokio::time::timeout(Duration::from_millis(50), pool.reader()).await.is_err(), "single connection allowed concurrent lease");
    drop(lease);
    let reader = tokio::time::timeout(Duration::from_secs(2), pool.reader()).await.context("lease did not become available")?;
    ensure!(reader.query_row("SELECT count(*) FROM probe_project", [], |r|r.get::<_,i64>(0))? == 1, "leased connection unusable");
    drop(reader);
    tokio::time::timeout(Duration::from_secs(2), db.disconnect()).await.context("offline disconnect timed out")?;
    println!("G5 PARTIAL: real single-connection lease exclusion/release and never-connected disconnect completed.");
    println!("G5 NOT TESTED: running sync actor stop, production coordinator root/epoch switch and late callbacks; no simulated claim of integration.");
    Ok(())
}

async fn check_recovered(db: &PowerSyncDatabase, expected: &RecoveryExpected) -> Result<()> {
    let pending = db.next_crud_transaction().await?.context("recovery lost uncompleted SDK group")?;
    ensure!(frozen(&pending)? == expected.pending, "recovery changed pending identity/entries/payload/base");
    drop(pending);
    let reader = db.reader().await?;
    ensure!(quarantine_rows(&reader)? == expected.quarantine, "recovery changed quarantine identity/fingerprint/payload/base/reason bytes");
    ensure!(reader.query_row("PRAGMA integrity_check", [], |r|r.get::<_,String>(0))? == "ok", "recovery integrity failed");
    Ok(())
}

async fn recovery(path: &Path, evidence: &Evidence, expected: &RecoveryExpected) -> Result<()> {
    let (reopened, pool) = database(open_owned(path)?);
    check_recovered(&reopened, expected).await?;
    let restore_evidence = Evidence::create()?;
    let restored_path = restore_evidence.reserve("restored-synthetic.sqlite")?;
    {
        let reader = reopened.reader().await?;
        let mut dest = open_owned(&restored_path)?;
        backup_bounded(&reader, &mut dest)?;
    }
    drop(pool); drop(reopened);
    let (restored, restored_pool) = database(open_owned(&restored_path)?);
    check_recovered(&restored, expected).await?;
    drop(restored_pool); drop(restored);
    let mut recovery_file=OpenOptions::new().write(true).create_new(true).open(evidence.dir.join("recovery-evidence.txt"))?;
    writeln!(recovery_file,"Restored copy: {}\nTwo quarantine rows compared across all five columns, and third real SDK pending group compared in full.",restored_path.display())?;
    recovery_file.sync_all()?;
    println!("G4 RECOVERY PASS: SDK reopen and backup into a new synthetic directory preserve exact rescue rows AND full third uncompleted SDK group");
    Ok(())
}

pub async fn run() -> Result<()> {
    let evidence = Evidence::create()?;
    // Cooperative async deadline only: synchronous SQLite/filesystem calls cannot
    // be preempted by Tokio. Backup additionally checks a deadline between steps.
    let result = tokio::time::timeout(Duration::from_secs(45), async {
        PowerSyncEnvironment::powersync_auto_extension()?;
        let path = evidence.reserve("archive-synthetic.sqlite")?;
        let (db, pool) = database(open_owned(&path)?);
        setup(&db).await?;
        g1(&db, &evidence).await?;
        let mutation=uuid::Uuid::new_v4().to_string();
        g2(&db, &mutation).await?;
        g3(&db).await?;
        let expected = g4(&db, &mutation).await?;
        g5(&db, &pool).await?;
        drop(pool); drop(db);
        recovery(&path, &evidence, &expected).await?;
        println!("G6 NOT TESTED: no network connection or backend; no multi-device, retention, power-loss or long-offline claims.");
        Ok::<(), anyhow::Error>(())
    }).await.context("probe exceeded 45-second bound").and_then(|result|result);
    let summary = match &result { Ok(())=>"LOCAL PROBE COMPLETED; G3/G5 PARTIAL, G6 NOT TESTED".into(), Err(error)=>format!("FAILED: {error:#}") };
    let mut file=OpenOptions::new().write(true).create_new(true).open(evidence.dir.join("RESULT.txt"))?;
    writeln!(file,"{summary}")?; file.sync_all()?;
    if let Err(error)=result { bail!("{error:#}; retained evidence: {}", evidence.dir.display()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn sdk_and_sqlite_external_behavior_on_synthetic_database() {
        super::run().await.expect("isolated probe failed; see retained temp evidence");
    }
}

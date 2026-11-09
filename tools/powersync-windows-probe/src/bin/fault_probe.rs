//! Synthetic process-crash and SQLite capacity experiments only.
//! See ../../FAULT-PROBE.md and the isolated-validation plan. No network calls.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, bail, ensure};
use powersync::{
    ConnectionPool, CrudTransaction, PowerSyncDatabase,
    env::PowerSyncEnvironment,
    schema::{RawTable, RawTableSchema, Schema},
};
use rusqlite::{Connection, ErrorCode, OpenFlags, backup::{Backup, StepResult}, params};
use serde_json::{Value, json};
use uuid::Uuid;

const TABLES: [&str; 4] = ["fault_project", "fault_task", "fault_action", "fault_interval"];
const IDS: [&str; 4] = ["p", "t", "a", "i"];
const PARENTS: [Option<&str>; 4] = [None, Some("p"), Some("p"), Some("a")];
const REASON: &str = "synthetic rejection preservation; no server response";
const CHILD_BOUND: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Stage { BeforeCommit, AfterCommit, AfterQuarantineBeforeComplete }

impl Stage {
    fn name(self) -> &'static str {
        match self {
            Self::BeforeCommit => "beforecommit",
            Self::AfterCommit => "aftercommit",
            Self::AfterQuarantineBeforeComplete => "afterquarantine-beforecomplete",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "beforecommit" => Ok(Self::BeforeCommit),
            "aftercommit" => Ok(Self::AfterCommit),
            "afterquarantine-beforecomplete" => Ok(Self::AfterQuarantineBeforeComplete),
            _ => bail!("unknown child stage"),
        }
    }
}

struct Evidence { id: Uuid, dir: PathBuf, label: &'static str }

fn marker(id: Uuid, label: &str) -> String {
    format!("Orbita synthetic fault probe only\nuuid={id}\nstage={label}\n")
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn ordinary_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(metadata.is_file() && !metadata.file_type().is_symlink(), "expected ordinary file");
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        ensure!(metadata.file_attributes() & 0x400 == 0, "reparse-point file refused");
    }
    Ok(())
}

impl Evidence {
    fn create(label: &'static str) -> Result<Self> {
        let id = Uuid::new_v4();
        let root = fs::canonicalize(std::env::temp_dir())?;
        let dir = root.join(format!("Orbita-PowerSync-Fault-合成-{id}"));
        fs::create_dir(&dir).context("exclusive synthetic evidence directory")?;
        write_new(&dir.join("SYNTHETIC-ONLY.txt"), marker(id, label).as_bytes())?;
        println!("Retained synthetic evidence: {}", dir.display());
        Ok(Self { id, dir, label })
    }

    fn attach(id_text: &str, stage: Stage) -> Result<Self> {
        let id = Uuid::parse_str(id_text).context("invalid child UUID")?;
        ensure!(id.to_string() == id_text && id.get_version_num() == 4,
            "child requires a canonical lowercase hyphenated v4 UUID");
        let root = fs::canonicalize(std::env::temp_dir())?;
        let expected = root.join(format!("Orbita-PowerSync-Fault-合成-{id}"));
        let metadata = fs::symlink_metadata(&expected)?;
        ensure!(metadata.is_dir() && !metadata.file_type().is_symlink(), "invalid evidence directory");
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            ensure!(metadata.file_attributes() & 0x400 == 0, "reparse-point directory refused");
        }
        let dir = fs::canonicalize(&expected)?;
        ensure!(dir == expected && dir.parent() == Some(root.as_path()), "derived temp path escaped");
        ordinary_file(&dir.join("SYNTHETIC-ONLY.txt"))?;
        ensure!(fs::read(dir.join("SYNTHETIC-ONLY.txt"))? == marker(id, stage.name()).as_bytes(),
            "evidence marker UUID/stage mismatch");
        let evidence = Self { id, dir, label: stage.name() };
        ordinary_file(&evidence.subject())?;
        ordinary_file(&evidence.dir.join("oracle.json"))?;
        ensure!(!evidence.dir.join("ready.txt").try_exists()?, "stale ready marker refused");
        ensure!(!evidence.dir.join("ready-synced.txt").try_exists()?, "stale sync flag refused");
        Ok(evidence)
    }

    fn reserve(&self, name: &'static str) -> Result<PathBuf> {
        // All filenames are internal literals; callers cannot supply database paths.
        ensure!(!name.contains(['/', '\\']) && !name.starts_with('.'), "internal filename required");
        let path = self.dir.join(name);
        write_new(&path, b"")?;
        Ok(path)
    }

    fn subject(&self) -> PathBuf { self.dir.join("subject.sqlite") }
    fn mutation(&self) -> String { format!("{}-candidate", self.id) }
    fn ready_text(&self) -> String { format!("READY uuid={} stage={}\n", self.id, self.label) }

    fn record(&self, result: &Result<()>) -> Result<()> {
        let summary = match result {
            Ok(()) => format!("PASS {}: local synthetic evidence only; no power-loss/server claim\n", self.label),
            Err(error) => format!("FAILED {}: {error:#}\n", self.label),
        };
        write_new(&self.dir.join("RESULT.txt"), summary.as_bytes())
    }
}

fn configure(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;")?;
    ensure!(conn.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))? == "wal", "WAL required");
    ensure!(conn.query_row("PRAGMA synchronous", [], |r| r.get::<_, i64>(0))? == 2, "FULL required");
    ensure!(conn.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0))? == 1, "FK required");
    Ok(())
}

fn open_reserved(path: &Path) -> Result<Connection> {
    ordinary_file(path)?;
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    configure(&conn)?;
    Ok(conn)
}

fn database(conn: Connection) -> (PowerSyncDatabase, ConnectionPool) {
    let pool = ConnectionPool::single_connection(conn);
    let schema = Schema { tables: vec![], raw_tables: TABLES.into_iter()
        .map(|name| RawTable::with_schema(name, RawTableSchema::default())).collect() };
    let environment = PowerSyncEnvironment::custom(reqwest::Client::new(), pool.clone(), PowerSyncEnvironment::tokio());
    (PowerSyncDatabase::new(environment, schema), pool)
}

fn metadata(mutation: &str, base: i64) -> String {
    json!({"mutationId":mutation,"groupId":mutation,"command":"fault-only-group",
        "base":{"project":base,"task":base,"action":base,"interval":base},"protocol":"synthetic-only"}).to_string()
}

fn set_context(conn: &Connection, mutation: &str, base: i64) -> Result<()> {
    conn.execute("INSERT INTO fault_context VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET metadata=excluded.metadata",
        [metadata(mutation, base)])?;
    Ok(())
}

async fn setup_baseline(db: &PowerSyncDatabase, id: Uuid) -> Result<()> {
    {
        let conn = db.writer().await?;
        conn.execute_batch("
          CREATE TABLE fault_context(singleton INTEGER PRIMARY KEY CHECK(singleton=1),metadata TEXT NOT NULL);
          CREATE TABLE fault_project(id TEXT PRIMARY KEY,root_id TEXT,value TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE fault_task(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES fault_project(id) DEFERRABLE INITIALLY DEFERRED,value TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE fault_action(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES fault_project(id) DEFERRABLE INITIALLY DEFERRED,value TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE fault_interval(id TEXT PRIMARY KEY,root_id TEXT NOT NULL REFERENCES fault_action(id) DEFERRABLE INITIALLY DEFERRED,value TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE fault_quarantine(mutation_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,base TEXT NOT NULL,reason TEXT NOT NULL);
          CREATE TABLE fault_pressure(id TEXT PRIMARY KEY,payload BLOB NOT NULL);
        ")?;
        for table in TABLES {
            conn.execute_batch(&format!("
              CREATE TRIGGER {table}_insert AFTER INSERT ON {table} BEGIN
                INSERT INTO powersync_crud(op,id,type,data,metadata)
                VALUES('PUT',NEW.id,'{table}',json_object('root_id',NEW.root_id,'value',NEW.value,'revision',NEW.revision),
                  (SELECT metadata FROM fault_context WHERE singleton=1));
              END;
              CREATE TRIGGER {table}_update AFTER UPDATE ON {table} BEGIN
                INSERT INTO powersync_crud(op,id,type,data,old_values,metadata)
                VALUES('PATCH',NEW.id,'{table}',json_object('root_id',NEW.root_id,'value',NEW.value,'revision',NEW.revision),
                  json_object('root_id',OLD.root_id,'value',OLD.value,'revision',OLD.revision),
                  (SELECT metadata FROM fault_context WHERE singleton=1));
              END;
            "))?;
        }
        let transaction = conn.unchecked_transaction()?;
        set_context(&transaction, &format!("{id}-baseline"), 0)?;
        for (index, table) in TABLES.iter().enumerate() {
            transaction.execute(&format!("INSERT INTO {table} VALUES(?1,?2,?3,1)"),
                params![IDS[index], PARENTS[index], format!("baseline-{table}-中文")])?;
        }
        transaction.commit()?;
    }
    // This is local fixture preparation, never an assertion of server acceptance.
    let baseline = db.next_crud_transaction().await?.context("missing fixture baseline group")?;
    ensure!(baseline.crud.len() == 4, "incomplete baseline fixture");
    baseline.complete().await?;
    ensure!(db.next_crud_transaction().await?.is_none(), "fixture baseline queue not empty");
    Ok(())
}

fn write_candidate(conn: &Connection, mutation: &str) -> Result<()> {
    set_context(conn, mutation, 1)?;
    for (index, table) in TABLES.iter().enumerate() {
        let changed = conn.execute(&format!("UPDATE {table} SET value=?1,revision=2 WHERE id=?2"),
            params![format!("candidate-{table}-中文"), IDS[index]])?;
        ensure!(changed == 1, "candidate member missing");
    }
    Ok(())
}

fn freeze(group: &CrudTransaction<'_>) -> Result<(String, String, String)> {
    let first = group.crud.first().context("empty pending group")?;
    let meta: Value = serde_json::from_str(first.metadata.as_deref().context("missing metadata")?)?;
    let mutation = meta["mutationId"].as_str().context("missing stable mutation ID")?.to_owned();
    let entries: Vec<Value> = group.crud.iter().map(|entry| json!({
        "clientId":entry.client_id,"transactionId":entry.transaction_id,"table":entry.table,
        "id":entry.id,"operation":entry.update_type,"data":entry.data,
        "previousValues":entry.previous_values,"metadata":entry.metadata
    })).collect();
    for entry in &group.crud {
        let other: Value = serde_json::from_str(entry.metadata.as_deref().context("missing member metadata")?)?;
        ensure!(other == meta, "mixed metadata in pending group");
    }
    Ok((mutation, json!({"transactionId":group.id,"lastItemId":group.last_item_id,
        "metadata":meta,"entries":entries}).to_string(), meta["base"].to_string()))
}

fn validate_candidate(group: &CrudTransaction<'_>, mutation: &str) -> Result<()> {
    ensure!(group.id.is_some() && group.crud.len() == 4, "candidate split or incomplete");
    for (index, entry) in group.crud.iter().enumerate() {
        ensure!(entry.table == TABLES[index] && entry.id == IDS[index], "candidate table/member order changed");
        ensure!(entry.transaction_id == group.id.unwrap(), "candidate has mixed transaction IDs");
        ensure!(serde_json::to_value(&entry.update_type)? == json!("PATCH"), "candidate operation changed");
        ensure!(entry.metadata.as_deref() == Some(metadata(mutation, 1).as_str()), "candidate metadata/base changed");
        ensure!(serde_json::to_value(&entry.data)? == json!({"root_id":PARENTS[index],
            "value":format!("candidate-{}-中文",TABLES[index]),"revision":2}), "candidate full data changed");
        ensure!(serde_json::to_value(&entry.previous_values)? == json!({"root_id":PARENTS[index],
            "value":format!("baseline-{}-中文",TABLES[index]),"revision":1}), "candidate previous values changed");
    }
    Ok(())
}

async fn preserve_pending(db: &PowerSyncDatabase, mutation: &str) -> Result<()> {
    let group = db.next_crud_transaction().await?.context("missing group to preserve")?;
    validate_candidate(&group, mutation)?;
    let (id, payload, base) = freeze(&group)?;
    let conn = db.writer().await?;
    let transaction = conn.unchecked_transaction()?;
    transaction.execute("INSERT INTO fault_quarantine VALUES(?1,?2,?2,?3,?4)", params![id,payload,base,REASON])?;
    transaction.commit()?;
    let row: (String, String, String, String, String) = conn.query_row(
        "SELECT mutation_id,fingerprint,payload,base,reason FROM fault_quarantine", [],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?;
    ensure!(row == (id,payload.clone(),payload,base,REASON.to_owned()), "quarantine readback differs");
    // Intentionally stop before SDK complete; force-stop must preserve both copies.
    Ok(())
}

fn sql_snapshot(conn: &Connection) -> Result<Value> {
    let mut domains = serde_json::Map::new();
    for table in TABLES {
        let mut statement = conn.prepare(&format!("SELECT id,root_id,value,revision FROM {table} ORDER BY id"))?;
        let rows = statement.query_map([], |r| Ok(json!([r.get::<_, String>(0)?,r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,r.get::<_, i64>(3)?])))?.collect::<rusqlite::Result<Vec<_>>>()?;
        domains.insert(table.to_owned(), json!(rows));
    }
    let mut statement = conn.prepare("SELECT singleton,metadata FROM fault_context ORDER BY singleton")?;
    let context = statement.query_map([], |r| Ok(json!([r.get::<_, i64>(0)?,r.get::<_, String>(1)?])))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare("SELECT id,tx_id,data FROM ps_crud ORDER BY id")?;
    let queue = statement.query_map([], |r| Ok(json!([r.get::<_, i64>(0)?,r.get::<_, i64>(1)?,r.get::<_, String>(2)?])))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare("SELECT mutation_id,fingerprint,payload,base,reason FROM fault_quarantine ORDER BY mutation_id")?;
    let quarantine = statement.query_map([], |r| Ok(json!([r.get::<_, String>(0)?,r.get::<_, String>(1)?,
        r.get::<_, String>(2)?,r.get::<_, String>(3)?,r.get::<_, String>(4)?])))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut statement = conn.prepare("SELECT id,hex(payload) FROM fault_pressure ORDER BY id")?;
    let pressure = statement.query_map([], |r| Ok(json!([r.get::<_, String>(0)?,r.get::<_, String>(1)?])))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(json!({"domain":domains,"context":context,"rawQueue":queue,"quarantine":quarantine,"pressure":pressure}))
}

async fn snapshot(db: &PowerSyncDatabase, expected_mutation: Option<&str>) -> Result<Value> {
    let group = db.next_crud_transaction().await?;
    let sdk = match group {
        Some(group) => {
            validate_candidate(&group, expected_mutation.context("unexpected pending group")?)?;
            let (id, payload, base) = freeze(&group)?;
            json!({"id":id,"payload":payload,"base":base})
        }
        None => { ensure!(expected_mutation.is_none(), "candidate group disappeared"); Value::Null }
    };
    let conn = db.reader().await?;
    ensure!(conn.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? == "ok", "integrity check failed");
    let mut sql = sql_snapshot(&conn)?;
    ensure!(sql["rawQueue"].as_array().context("invalid queue snapshot")?.len() == if sdk.is_null() { 0 } else { 4 },
        "unexpected extra or missing SDK queue groups");
    sql["sdkGroup"] = sdk;
    Ok(sql)
}

fn backup(source: &Connection, destination: &mut Connection) -> Result<()> {
    let backup = Backup::new(source, destination)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    for _ in 0..500 {
        ensure!(Instant::now() < deadline, "oracle backup cooperative deadline exceeded");
        if matches!(backup.step(5)?, StepResult::Done) { return Ok(()); }
        std::thread::sleep(Duration::from_millis(10));
    }
    bail!("oracle backup step limit exceeded")
}

async fn prepare_oracle(evidence: &Evidence, stage: Stage) -> Result<Value> {
    let subject = evidence.reserve("subject.sqlite")?;
    let oracle_path = evidence.reserve("oracle.sqlite")?;
    let (db, pool) = database(open_reserved(&subject)?);
    setup_baseline(&db, evidence.id).await?;
    let baseline = snapshot(&db, None).await?;
    {
        let source = db.reader().await?;
        let mut destination = open_reserved(&oracle_path)?;
        backup(&source, &mut destination)?;
    }
    db.disconnect().await;
    drop(pool); drop(db);

    // Freeze an independent pre-crash oracle before the child exists. SDK IDs
    // originate from the copied baseline, never from post-crash observations.
    let (oracle, oracle_pool) = database(open_reserved(&oracle_path)?);
    ensure!(snapshot(&oracle, None).await? == baseline, "oracle baseline copy differs");
    {
        let conn = oracle.writer().await?;
        let transaction = conn.unchecked_transaction()?;
        write_candidate(&transaction, &evidence.mutation())?;
        if stage == Stage::BeforeCommit { transaction.rollback()?; } else { transaction.commit()?; }
    }
    if stage == Stage::AfterQuarantineBeforeComplete { preserve_pending(&oracle, &evidence.mutation()).await?; }
    let mutation = evidence.mutation();
    let expected = snapshot(&oracle, if stage == Stage::BeforeCommit { None } else { Some(mutation.as_str()) }).await?;
    if stage == Stage::BeforeCommit { ensure!(expected == baseline, "oracle rollback changed baseline"); }
    let bytes = serde_json::to_vec_pretty(&json!({"uuid":evidence.id.to_string(),"stage":stage.name(),"expected":expected}))?;
    write_new(&evidence.dir.join("oracle.json"), &bytes)?;
    oracle.disconnect().await;
    drop(oracle_pool); drop(oracle);
    Ok(expected)
}

struct OwnedChild { child: Option<Child> }

impl OwnedChild {
    fn spawn(evidence: &Evidence, stage: Stage) -> Result<Self> {
        let mut command = Command::new(std::env::current_exe()?);
        command.arg("--child").arg(evidence.id.to_string()).arg(stage.name())
            .stdin(Stdio::null()).stdout(Stdio::inherit()).stderr(Stdio::inherit());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW; child never spawns descendants.
        }
        Ok(Self { child: Some(command.spawn().context("spawn owned fault child")?) })
    }

    fn child(&mut self) -> Result<&mut Child> { self.child.as_mut().context("owned child already reaped") }

    fn terminate_and_wait(&mut self) -> Result<ExitStatus> {
        let child = self.child()?;
        ensure!(child.try_wait()?.is_none(), "child exited before controlled force-stop");
        child.kill().context("kill exact owned Child")?;
        let status = child.wait().context("wait for owned child exit")?;
        self.child = None;
        ensure!(!status.success(), "force-stopped child unexpectedly reported success");
        Ok(status)
    }

    fn wait_ready(&mut self, evidence: &Evidence) -> Result<()> {
        let deadline = Instant::now() + CHILD_BOUND;
        loop {
            if let Some(status) = self.child()?.try_wait()? { bail!("child exited before force-stop: {status}"); }
            ensure!(Instant::now() < deadline, "child ready marker exceeded 30-second bound");
            let ready = evidence.dir.join("ready.txt");
            if ready.try_exists()? {
                ordinary_file(&ready)?;
                // A writer may have created the file but not completed its sync.
                // The separate durable flag is written only after ready.txt sync.
                let synced = evidence.dir.join("ready-synced.txt");
                if synced.try_exists()? {
                    ordinary_file(&synced)?;
                    ensure!(fs::read(&ready)? == evidence.ready_text().as_bytes(), "ready UUID/stage mismatch");
                    ensure!(fs::metadata(&synced)?.len() == 0, "invalid ready sync flag");
                    return Ok(());
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            // Every error path reaps only the directly-owned process; no name/PID
            // sweeps, shell, grandchildren, retries, or recursive filesystem cleanup.
            match child.try_wait() {
                Ok(Some(_)) => {},
                Ok(None) => { if let Err(error) = child.kill() { eprintln!("owned child cleanup kill failed: {error}"); } },
                Err(error) => { eprintln!("owned child status failed: {error}"); if let Err(error) = child.kill() { eprintln!("owned child cleanup kill failed: {error}"); } },
            }
            if let Err(error) = child.wait() { eprintln!("owned child cleanup wait failed: {error}; no recovery is attempted"); }
        }
    }
}

async fn child_run(evidence: Evidence, stage: Stage) -> Result<()> {
    let oracle: Value = serde_json::from_slice(&fs::read(evidence.dir.join("oracle.json"))?)?;
    ensure!(oracle["uuid"] == evidence.id.to_string() && oracle["stage"] == stage.name(), "child oracle identity mismatch");
    let (db, _pool) = database(open_reserved(&evidence.subject())?);
    let conn = db.writer().await?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    write_candidate(&conn, &evidence.mutation())?;
    if stage != Stage::BeforeCommit { conn.execute_batch("COMMIT")?; }
    if stage == Stage::AfterQuarantineBeforeComplete {
        drop(conn);
        preserve_pending(&db, &evidence.mutation()).await?;
    } else {
        // For beforecommit keep the lease and live SQL transaction across ready
        // and force-stop; no destructor rollback is allowed to replace the crash.
        return ready_and_hold(&evidence, conn).await;
    }
    ready_and_hold(&evidence, ()).await
}

async fn ready_and_hold<T>(evidence: &Evidence, held: T) -> Result<()> {
    write_new(&evidence.dir.join("ready.txt"), evidence.ready_text().as_bytes())?;
    // Its creation is the signal: ready.txt has already been completely synced.
    // An empty signal avoids a partial-content race while the parent polls it.
    write_new(&evidence.dir.join("ready-synced.txt"), b"")?;
    loop {
        // Borrow after every await so the compiler cannot end the held lease early.
        tokio::time::sleep(Duration::from_secs(1)).await;
        std::hint::black_box(&held);
    }
}

async fn crash_stage_inner(evidence: &Evidence, stage: Stage) -> Result<()> {
    let expected = prepare_oracle(evidence, stage).await?;
    let oracle_bytes = fs::read(evidence.dir.join("oracle.json"))?;
    let mut child = OwnedChild::spawn(evidence, stage)?;
    child.wait_ready(evidence)?;
    let status = child.terminate_and_wait()?;
    drop(child);
    // Opening SQLite is strictly after wait(), never racing the terminated writer.
    ensure!(fs::read(evidence.dir.join("oracle.json"))? == oracle_bytes, "pre-crash oracle changed");
    let (reopened, pool) = database(open_reserved(&evidence.subject())?);
    let mutation = evidence.mutation();
    let actual = snapshot(&reopened, if stage == Stage::BeforeCommit { None } else { Some(mutation.as_str()) }).await?;
    ensure!(actual == expected, "recovered full domain/context/raw queue/SDK metadata/base/rescue differs from oracle");
    write_new(&evidence.dir.join("recovered.json"), &serde_json::to_vec_pretty(&actual)?)?;
    write_new(&evidence.dir.join("child-exit.txt"), format!("force-stop exit={status}; wait completed before reopen\n").as_bytes())?;
    reopened.disconnect().await;
    drop(pool); drop(reopened);
    println!("PASS {}: process crash, full recovery equality; not host power loss", stage.name());
    Ok(())
}

async fn crash_stage(stage: Stage) -> Result<()> {
    let evidence = Evidence::create(stage.name())?;
    let result = crash_stage_inner(&evidence, stage).await;
    evidence.record(&result)?;
    result.with_context(|| format!("{}; evidence retained at {}", stage.name(), evidence.dir.display()))
}

fn verify_inflight_candidate(conn: &Connection, mutation: &str) -> Result<()> {
    // Inspect the active transaction on its own connection: an early FULL must
    // not substitute for rolling back a fully staged four-member SDK group.
    ensure!(!conn.is_autocommit(), "candidate transaction already ended");
    let actual = sql_snapshot(conn)?;
    for (index, table) in TABLES.iter().enumerate() {
        ensure!(actual["domain"][*table] == json!([[IDS[index],PARENTS[index],
            format!("candidate-{table}-中文"),2]]), "inflight {table} full row differs");
    }
    let expected_metadata = metadata(mutation, 1);
    ensure!(actual["context"] == json!([[1,expected_metadata]]), "inflight context/metadata/base differs");
    ensure!(actual["quarantine"] == json!([]) && actual["pressure"] == json!([]),
        "unexpected rescue/pressure content before FULL");
    let queue = actual["rawQueue"].as_array().context("inflight raw SDK queue is not an array")?;
    ensure!(queue.len() == 4, "all four raw SDK CRUD rows must exist before pressure");
    let transaction_id = queue[0][1].as_i64().context("missing inflight SDK transaction ID")?;
    for (index, row) in queue.iter().enumerate() {
        ensure!(row[0].as_i64().is_some() && row[1].as_i64() == Some(transaction_id),
            "inflight CRUD IDs/grouping differ");
        let data: Value = serde_json::from_str(row[2].as_str().context("missing raw CRUD payload")?)?;
        ensure!(data["op"] == "PATCH" && data["type"] == TABLES[index] && data["id"] == IDS[index],
            "inflight raw CRUD member/operation differs");
        ensure!(data["metadata"] == expected_metadata, "inflight raw CRUD metadata/base differs");
        ensure!(data["data"] == json!({"root_id":PARENTS[index],
            "value":format!("candidate-{}-中文",TABLES[index]),"revision":2}),
            "inflight raw CRUD full new values differ");
        ensure!(data["old"] == json!({"root_id":PARENTS[index],
            "value":format!("baseline-{}-中文",TABLES[index]),"revision":1}),
            "inflight raw CRUD previous values differ");
    }
    Ok(())
}

async fn disk_full_inner(evidence: &Evidence) -> Result<()> {
    let path = evidence.reserve("subject.sqlite")?;
    let (db, pool) = database(open_reserved(&path)?);
    setup_baseline(&db, evidence.id).await?;
    let baseline = snapshot(&db, None).await?;
    write_new(&evidence.dir.join("oracle.json"), &serde_json::to_vec_pretty(&baseline)?)?;
    let (error_text, autocommit_after_error, pages, max_pages, page_size);
    {
        let conn = db.writer().await?;
        pages = conn.query_row("PRAGMA page_count", [], |r| r.get::<_, i64>(0))?;
        page_size = conn.query_row("PRAGMA page_size", [], |r| r.get::<_, i64>(0))?;
        let original_max: i64 = conn.query_row("PRAGMA max_page_count", [], |r| r.get(0))?;
        ensure!(pages > 0 && page_size > 0, "invalid SQLite page settings");
        // Fixed small headroom permits staging all domain/queue writes first;
        // never adjust/retry the cap to turn an early failure into a green run.
        let capacity = pages.checked_add(16).context("page cap overflow")?;
        max_pages = conn.query_row(&format!("PRAGMA max_page_count={capacity}"), [], |r| r.get::<_, i64>(0))?;
        let readback: i64 = conn.query_row("PRAGMA max_page_count", [], |r| r.get(0))?;
        ensure!(max_pages == capacity && readback == capacity, "max_page_count did not apply");
        let blob_size = max_pages.checked_add(32).and_then(|n| n.checked_mul(page_size)).context("blob size overflow")?;
        ensure!(blob_size <= 32 * 1024 * 1024, "synthetic capacity probe refuses a large blob");
        let mut progress = json!({"phase":"preparation","statement":"BEGIN IMMEDIATE",
            "completedDomainUpdates":0,"candidateVerified":false,"pressureAttempted":false,
            "pageCount":pages,"headroomPages":16,"maxPageCountReadback":max_pages,"blobBytes":blob_size});
        let prepared = (|| -> Result<()> {
            conn.execute_batch("BEGIN IMMEDIATE")?;
            progress["statement"] = json!("INSERT/UPDATE fault_context metadata");
            conn.execute("INSERT INTO fault_context VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET metadata=excluded.metadata",
                [metadata(&evidence.mutation(), 1)])?;
            for (index, table) in TABLES.iter().enumerate() {
                let sql = format!("UPDATE {table} SET value=?1,revision=2 WHERE id=?2");
                progress["statement"] = json!(sql);
                let changed = conn.execute(&sql,
                    params![format!("candidate-{table}-中文"),IDS[index]])?;
                ensure!(changed == 1, "candidate member {table} missing before pressure");
                progress["completedDomainUpdates"] = json!(index + 1);
            }
            progress["statement"] = json!("verify full inflight domain/context/4 raw SDK CRUD rows");
            verify_inflight_candidate(&conn, &evidence.mutation())?;
            progress["candidateVerified"] = json!(true);
            Ok(())
        })();
        if let Err(error) = prepared {
            progress["failure"] = json!(format!("candidate preparation failed before pressure: {error:#}"));
            progress["autocommitAfterFailure"] = json!(conn.is_autocommit());
            let cleanup = if conn.is_autocommit() { Ok(()) } else { conn.execute_batch("ROLLBACK") };
            progress["rollbackCleanup"] = json!(match &cleanup { Ok(()) => "ok".to_owned(), Err(error) => error.to_string() });
            write_new(&evidence.dir.join("diskfull-progress.json"), &serde_json::to_vec_pretty(&progress)?)?;
            cleanup.context("candidate preparation failure rollback")?;
            bail!("DiskFull pressure stage NOT REACHED; candidate preparation failed: {error:#}");
        }
        progress["phase"] = json!("pressure");
        progress["statement"] = json!("INSERT INTO fault_pressure VALUES('overflow',zeroblob(?1))");
        progress["pressureAttempted"] = json!(true);
        // This single blob alone exceeds the entire capped database capacity.
        // Only this statement's actual DiskFull is accepted as the fault hit.
        let pressure = conn.execute("INSERT INTO fault_pressure VALUES('overflow',zeroblob(?1))", [blob_size]);
        autocommit_after_error = conn.is_autocommit();
        progress["autocommitAfterPressure"] = json!(autocommit_after_error);
        progress["pressureResult"] = json!(match &pressure {
            Ok(rows) => format!("unexpected success: {rows} rows"), Err(error) => format!("{error:?}")
        });
        let cleanup = if autocommit_after_error { Ok(()) } else { conn.execute_batch("ROLLBACK") };
        progress["rollbackCleanup"] = json!(match &cleanup { Ok(()) => "ok".to_owned(), Err(error) => error.to_string() });
        write_new(&evidence.dir.join("diskfull-progress.json"), &serde_json::to_vec_pretty(&progress)?)?;
        cleanup.context("pressure failure rollback")?;
        let failure = pressure.err().context("bounded max_page_count unexpectedly accepted oversized pressure blob")?;
        error_text = failure.to_string();
        ensure!(matches!(&failure, rusqlite::Error::SqliteFailure(code, _) if code.code == ErrorCode::DiskFull),
            "expected actual SQLite DiskFull code, got {failure:?}");
        ensure!(conn.is_autocommit(), "FULL cleanup left active transaction");
        let reset: i64 = conn.query_row(&format!("PRAGMA max_page_count={original_max}"), [], |r| r.get(0))?;
        ensure!(reset == original_max, "failed to restore experiment-local capacity ceiling");
    }
    ensure!(snapshot(&db, None).await? == baseline, "DiskFull changed complete baseline or queue");
    {
        let conn = db.writer().await?;
        // Successful writes and COMMIT on the same connection, followed by full
        // baseline equality, show reuse rather than only a working SELECT.
        conn.execute_batch("BEGIN IMMEDIATE; INSERT INTO fault_pressure VALUES('reuse',X'010203'); DELETE FROM fault_pressure WHERE id='reuse'; COMMIT;")?;
        ensure!(conn.is_autocommit(), "reuse commit left active transaction");
    }
    ensure!(snapshot(&db, None).await? == baseline, "reuse check changed baseline");
    write_new(&evidence.dir.join("diskfull.json"), &serde_json::to_vec_pretty(&json!({
        "sqliteError":error_text,"actualCode":"DiskFull","autocommitAfterError":autocommit_after_error,
        "pageCount":pages,"headroomPages":16,"maxPageCountReadback":max_pages,"pageSize":page_size,
        "fullCandidateAndFourRawCrudRowsVerifiedBeforePressure":true,
        "fullBaselineUnchanged":true,"sameConnectionWriteCommitReusable":true
    }))?)?;
    db.disconnect().await;
    drop(pool); drop(db);
    println!("PASS SQLITE_FULL: actual SQLite capacity code; full baseline preserved; same connection reused");
    Ok(())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    // Only parent/default mode may spawn, and it spawns exactly this executable.
    // Child mode accepts UUID + enum stage, never a path, command or endpoint.
    if args.len() == 4 && args[1] == "--child" {
        let stage = Stage::parse(&args[3])?;
        let evidence = Evidence::attach(&args[2], stage)?;
        PowerSyncEnvironment::powersync_auto_extension()?;
        return child_run(evidence, stage).await;
    }
    ensure!(args.len() == 1, "parent accepts no arguments; child accepts only --child UUID STAGE");
    PowerSyncEnvironment::powersync_auto_extension()?;
    for stage in [Stage::BeforeCommit, Stage::AfterCommit, Stage::AfterQuarantineBeforeComplete] {
        crash_stage(stage).await?;
    }
    let evidence = Evidence::create("sqlite-full")?;
    let result = disk_full_inner(&evidence).await;
    evidence.record(&result)?;
    result.with_context(|| format!("SQLITE_FULL; evidence retained at {}", evidence.dir.display()))?;
    println!("LOCAL FAULT PROBE COMPLETED: 3 process force-stops + bounded SQLite FULL only; no server/old-backup/power-loss evidence");
    Ok(())
}

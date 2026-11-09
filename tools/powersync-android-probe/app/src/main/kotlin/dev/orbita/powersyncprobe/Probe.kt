package dev.orbita.powersyncprobe

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Process
import android.system.Os
import android.system.OsConstants
import android.util.Log
import android.widget.TextView
import com.powersync.DatabaseDriverFactory
import com.powersync.PowerSyncDatabase
import com.powersync.db.crud.CrudEntry
import com.powersync.db.crud.SqliteRow
import com.powersync.db.schema.Column
import com.powersync.db.schema.Schema
import com.powersync.db.schema.Table
import com.powersync.db.schema.TableOptions
import com.powersync.db.schema.TrackPreviousValuesOptions
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private const val PROTOCOL = "orbita-powersync-android-offline-v1"
private const val SDK = "1.16.0"
private const val CORE = "0.5.4"
private const val DATABASE = "synthetic.db"
private const val TAG = "OrbitaPowerSyncProbe"
private const val INITIAL = "initial 合成 α"
private const val UPDATED = "updated 合成 Ω"
private const val SECOND = "second 合成 β"
private val manifestKeys = setOf("protocol", "sdk", "core", "run", "mutation", "database", "process", "pid")

class ProbeApplication : Application() {
    internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    internal val processNonce = UUID.randomUUID().toString()
    internal val started = AtomicBoolean(false)
    // Deliberately retained after READY; only the coordinator's later process termination closes it.
    @Volatile internal var liveDatabase: PowerSyncDatabase? = null
}

class SeedActivity : ProbeActivity() { override val recovering = false }
class RecoverActivity : ProbeActivity() { override val recovering = true }

abstract class ProbeActivity : Activity() {
    protected abstract val recovering: Boolean

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val view = TextView(this).apply { text = "Checking isolated synthetic probe…"; setPadding(32, 64, 32, 32) }
        setContentView(view)
        val app = application as ProbeApplication
        // No caller-controlled run ID, path, payload, URI, or mode may reach filesystem operations.
        if (intent.data != null || intent.clipData != null || intent.selector != null ||
            (intent.extras?.isEmpty == false)) {
            view.text = "REFUSED: launch accepts no data or extras."
            return
        }
        if (!app.started.compareAndSet(false, true)) {
            view.text = "REFUSED: one operation per process; retain existing evidence."
            return
        }
        app.scope.launch {
            try {
                val result = if (recovering) recover(app) else seed(app)
                Log.i(TAG, result)
                runOnUiThread { view.text = result }
            } catch (error: Exception) {
                // Failure is visible and never falls back to creating or clearing another database.
                val result = "FAILED ${if (recovering) "recovery" else "seed"}: ${error.javaClass.simpleName}: ${error.message?.take(240)}"
                Log.e(TAG, result)
                runOnUiThread { view.text = result }
            }
        }
    }
}

private fun root(app: ProbeApplication): File {
    val parent = app.filesDir.canonicalFile
    val root = File(parent, "powersync-synthetic-v1")
    check(root.canonicalFile == root.absoluteFile) { "Internal root redirects" }
    return root
}

private fun child(parent: File, name: String): File {
    check(name.matches(Regex("[A-Za-z0-9._-]+"))) { "Invalid internal name" }
    val file = File(parent, name)
    check(file.canonicalFile == file.absoluteFile && file.parentFile == parent) { "Internal path redirects" }
    return file
}

private fun syncDirectory(directory: File) {
    val fd = Os.open(directory.path, OsConstants.O_RDONLY, 0)
    try {
        // O_DIRECTORY is not public Android API. Validate the opened descriptor itself before fsync.
        // https://developer.android.com/reference/android/system/OsConstants#S_ISDIR(int)
        check(OsConstants.S_ISDIR(Os.fstat(fd).st_mode)) { "Evidence parent descriptor is not a directory" }
        Os.fsync(fd)
    } finally { Os.close(fd) }
}

private fun exclusiveWrite(file: File, text: String) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    check(bytes.size <= 1024 * 1024) { "Evidence too large" }
    val fd = Os.open(file.path, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL, 384)
    FileOutputStream(fd).use { output -> output.write(bytes); output.fd.sync() }
    syncDirectory(file.parentFile!!)
}

private fun readEvidence(file: File): String {
    check(file.isFile && file.length() in 1..(1024L * 1024)) { "Missing or oversized evidence" }
    return file.readText(Charsets.UTF_8)
}

private fun json(vararg fields: Pair<String, Any?>): JSONObject = JSONObject().apply {
    fields.forEach { (name, value) -> put(name, value ?: JSONObject.NULL) }
}

// Stable key ordering preserves every JSON value and array order without relying on Map.toString().
private fun canonical(value: Any?): String = when (value) {
    null, JSONObject.NULL -> "null"
    is JSONObject -> value.keys().asSequence().toList().sorted().joinToString(",", "{", "}") {
        JSONObject.quote(it) + ":" + canonical(value.get(it))
    }
    is JSONArray -> (0 until value.length()).joinToString(",", "[", "]") { canonical(value.get(it)) }
    is String -> JSONObject.quote(value)
    is Number, is Boolean -> value.toString()
    else -> error("Unsupported evidence value")
}

private fun row(value: SqliteRow?): Any = value?.let { JSONObject(it.jsonValues.toString()) } ?: JSONObject.NULL

private fun crud(entry: CrudEntry): JSONObject = json(
    "id" to entry.id, "clientId" to entry.clientId, "op" to entry.op.name,
    "table" to entry.table, "transactionId" to entry.transactionId,
    "metadata" to entry.metadata, "opData" to row(entry.opData), "previousValues" to row(entry.previousValues),
)

private fun schema() = Schema(listOf(Table(
    name = "probe_items",
    columns = listOf(Column.text("label"), Column.integer("amount")),
    options = TableOptions(trackMetadata = true, trackPreviousValues = TrackPreviousValuesOptions()),
)))

private fun open(app: ProbeApplication, run: File): PowerSyncDatabase {
    check(app.liveDatabase == null) { "Database already open in this process" }
    return PowerSyncDatabase(
        factory = DatabaseDriverFactory(app.applicationContext), schema = schema(),
        dbFilename = DATABASE, dbDirectory = run.path, scope = app.scope,
    ).also { app.liveDatabase = it }
}

private suspend fun snapshot(db: PowerSyncDatabase, mutation: String): String {
    val domain = db.getAll("SELECT id, label, amount FROM probe_items ORDER BY id") { cursor ->
        json("id" to cursor.getString(0), "label" to cursor.getString(1), "amount" to cursor.getLong(2))
    }
    check(domain.size == 2) { "Domain row count differs" }
    check(canonical(domain[0]) == canonical(json("id" to "a", "label" to UPDATED, "amount" to -9L))) { "First row differs" }
    check(canonical(domain[1]) == canonical(json("id" to "b", "label" to SECOND, "amount" to 11L))) { "Second row differs" }
    // Inspect whole transactions. A batch limit could split one transaction and conceal a missing tail.
    val transactions = db.getCrudTransactions().take(2).toList()
    check(transactions.size == 1) { "Expected exactly one pending transaction" }
    val transaction = transactions.single()
    val entries = transaction.crud
    check(transaction.transactionId != null && entries.size == 3) { "Incomplete pending transaction" }
    check(entries.all { it.transactionId == transaction.transactionId && it.table == "probe_items" && it.metadata == mutation }) { "Transaction identity or metadata differs" }
    check(entries.map { it.clientId }.zipWithNext().all { (a, b) -> a < b }) { "CRUD order differs" }
    check(entries.map { it.id } == listOf("a", "b", "a") && entries.map { it.op.name } == listOf("PUT", "PUT", "PATCH")) { "CRUD operations differ" }
    val expected = listOf(json("label" to INITIAL, "amount" to 7), json("label" to SECOND, "amount" to 11), json("label" to UPDATED, "amount" to -9))
    entries.forEachIndexed { index, entry -> check(canonical(row(entry.opData)) == canonical(expected[index])) { "CRUD payload differs" } }
    check(entries[0].previousValues == null && entries[1].previousValues == null) { "Unexpected insert old values" }
    check(canonical(row(entries[2].previousValues)) == canonical(expected[0])) { "Update old values differ" }
    return canonical(json(
        "protocol" to PROTOCOL, "sdk" to SDK, "core" to CORE,
        "domain" to JSONArray(domain), "transactionId" to transaction.transactionId,
        "crud" to JSONArray(entries.map(::crud)),
    ))
}

private suspend fun seed(app: ProbeApplication): String {
    val root = root(app)
    if (!root.exists()) { check(root.mkdir()) { "Cannot create internal root" }; syncDirectory(root.parentFile!!) }
    check(root.isDirectory) { "Internal root missing" }
    val manifestFile = child(root, "manifest.json")
    check(!manifestFile.exists()) { "A run already exists; seed will never replace it" }
    val runId = UUID.randomUUID().toString()
    val mutation = UUID.randomUUID().toString()
    val run = child(root, runId)
    check(run.mkdir()) { "Run directory not exclusively created" }
    syncDirectory(root)
    // Reserve the run before opening SQLite. A crash at any later boundary leaves a refused/incomplete
    // run, never an excuse to reseed. See docs/plans/powersync-windows-isolated-validation.md (D).
    val manifest = json("protocol" to PROTOCOL, "sdk" to SDK, "core" to CORE, "run" to runId,
        "mutation" to mutation, "database" to DATABASE, "process" to app.processNonce, "pid" to Process.myPid())
    exclusiveWrite(manifestFile, canonical(manifest))
    check(!child(run, DATABASE).exists()) { "Seed database already exists" }
    val db = open(app, run)
    db.writeLockAsync { connection ->
        connection.executeAsync("PRAGMA synchronous = FULL")
        check(connection.getAsync("PRAGMA synchronous") { it.getLong(0) ?: -1L } == 2L) { "FULL not active" }
        check(connection.getAsync("PRAGMA journal_mode") { it.getString(0) ?: "" }.lowercase() == "wal") { "WAL not active" }
    }
    db.writeTransactionAsync { tx ->
        tx.executeAsync("INSERT INTO probe_items(id,label,amount,_metadata) VALUES(?,?,?,?)", listOf("a", INITIAL, 7L, mutation))
        tx.executeAsync("INSERT INTO probe_items(id,label,amount,_metadata) VALUES(?,?,?,?)", listOf("b", SECOND, 11L, mutation))
        tx.executeAsync("UPDATE probe_items SET label=?,amount=?,_metadata=? WHERE id=?", listOf(UPDATED, -9L, mutation, "a"))
    }
    val oracle = snapshot(db, mutation)
    exclusiveWrite(child(run, "oracle.json"), oracle)
    exclusiveWrite(child(run, "READY"), canonical(json("protocol" to PROTOCOL, "run" to runId, "sha256" to sha256(oracle))))
    // Do not close here: clean close/reopen is not process interruption. No network or queue completion.
    return "READY seed; run=$runId pid=${Process.myPid()} entries=3 rows=2 pending=1. Database remains open. Await coordinator process-stop; no sync tested."
}

private fun uuid(value: String): String = UUID.fromString(value).toString().also { check(it == value) { "Noncanonical UUID" } }
private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 255) }

private suspend fun recover(app: ProbeApplication): String {
    val root = root(app)
    check(root.isDirectory) { "No existing internal run" }
    val manifest = JSONObject(readEvidence(child(root, "manifest.json")))
    check(manifest.keys().asSequence().toSet() == manifestKeys) { "Manifest fields differ" }
    check(manifest.getString("protocol") == PROTOCOL && manifest.getString("sdk") == SDK && manifest.getString("core") == CORE && manifest.getString("database") == DATABASE) { "Manifest version differs" }
    val runId = uuid(manifest.getString("run"))
    val mutation = uuid(manifest.getString("mutation"))
    check(uuid(manifest.getString("process")) != app.processNonce && manifest.getInt("pid") > 0) { "Recovery must run in a new process" }
    val run = child(root, runId)
    check(run.isDirectory) { "Original run directory missing" }
    val dbFile = child(run, DATABASE)
    check(dbFile.isFile && dbFile.length() > 0) { "Original database missing; refusing SDK open/create" }
    val expected = readEvidence(child(run, "oracle.json"))
    check(canonical(JSONObject(expected)) == expected) { "Noncanonical oracle" }
    val ready = JSONObject(readEvidence(child(run, "READY")))
    check(ready.keys().asSequence().toSet() == setOf("protocol", "run", "sha256") && ready.getString("protocol") == PROTOCOL && ready.getString("run") == runId && ready.getString("sha256") == sha256(expected)) { "READY does not match original oracle" }
    val db = open(app, run)
    try {
        check(snapshot(db, mutation) == expected) { "Recovered domain or complete CRUD oracle differs" }
    } finally {
        // All reads/writes above have completed before safe close; concurrent-close regression pending.
        db.close()
        app.liveDatabase = null
    }
    exclusiveWrite(child(run, "RECOVERED.json"), canonical(json("protocol" to PROTOCOL, "run" to runId, "oracleSha256" to sha256(expected), "seedPid" to manifest.getInt("pid"), "recoveryPid" to Process.myPid(), "recoveryProcess" to app.processNonce)))
    return "RECOVERED local-only; run=$runId seedPid=${manifest.getInt("pid")} recoveryPid=${Process.myPid()} rows=2 entries=3 pending=1 oracleSha256=${sha256(expected)}. Safe close completed. No upload ACK, complete, or network sync."
}

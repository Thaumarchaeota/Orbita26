use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::{
    finance_v2_domain::Id,
    finance_v2_store::{schema, StoreError},
    finance_v2_workspace::{IsolatedWorkspaceRoot, LedgerIdentity},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceV2Session {
    pub session_id: String,
    pub root_path: String,
    pub workspace_id: Id,
    pub ledger_identity: LedgerIdentity,
    pub marker_version: u32,
    pub scope: String,
    pub generation: u64,
}

#[derive(Clone)]
struct SessionRecord { root: PathBuf, workspace_id: Id, ledger_identity: LedgerIdentity }

fn sessions() -> &'static Mutex<HashMap<String, SessionRecord>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, SessionRecord>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn finance_v2_write_lock() -> Result<MutexGuard<'static, ()>, String> {
    static WRITE_COORDINATOR: Mutex<()> = Mutex::new(());
    WRITE_COORDINATOR.lock().map_err(|_| "Finance v2 write coordinator unavailable".into())
}

/// Resolve a root-relative output path without permitting traversal or a
/// symlink/junction/reparse point at any existing path component.
pub(crate) fn guarded_root_path(root: &IsolatedWorkspaceRoot, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if relative.is_empty() || rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("output path must be a normalized root-relative path".into());
    }
    let candidate = root.path().join(rel);
    let mut cursor = root.path().to_owned();
    for component in rel.components() {
        let Component::Normal(part) = component else { return Err("invalid output path component".into()); };
        cursor.push(part);
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() || is_reparse(&meta) => return Err("output path contains a symlink or reparse point".into()),
            Ok(meta) if cursor == candidate && meta.is_dir() => return Err("output file path is a directory".into()),
            Ok(meta) if cursor != candidate && !meta.is_dir() => return Err("output parent is not a directory".into()),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
    }
    let canonical_root = fs::canonicalize(root.path()).map_err(|e| e.to_string())?;
    let parent = candidate.parent().ok_or_else(|| "output path has no parent".to_owned())?;
    let nearest = nearest_existing(parent)?;
    let canonical_parent = fs::canonicalize(nearest).map_err(|e| e.to_string())?;
    if canonical_parent != canonical_root && !canonical_parent.starts_with(&canonical_root) { return Err("output path escaped isolated root".into()); }
    Ok(candidate)
}

pub(crate) fn ensure_root_directory(root:&IsolatedWorkspaceRoot,relative:&str)->Result<PathBuf,String>{
    let rel=Path::new(relative);
    if relative.is_empty()||rel.is_absolute()||rel.components().any(|c|!matches!(c,Component::Normal(_))){return Err("directory path must be normalized and root-relative".into())}
    let mut cursor=root.path().to_owned();
    for component in rel.components(){
        let Component::Normal(part)=component else{return Err("invalid directory component".into())};
        cursor.push(part);
        match fs::symlink_metadata(&cursor){
            Ok(meta) if meta.file_type().is_symlink()||is_reparse(&meta)||!meta.is_dir()=>return Err("directory path contains a non-directory or reparse point".into()),
            Ok(_)=>{},
            Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{
                fs::create_dir(&cursor).map_err(|e|e.to_string())?;
                let meta=fs::symlink_metadata(&cursor).map_err(|e|e.to_string())?;
                if meta.file_type().is_symlink()||is_reparse(&meta)||!meta.is_dir(){return Err("created directory escaped isolated root".into())}
            }
            Err(error)=>return Err(error.to_string()),
        }
    }
    let root_canon=fs::canonicalize(root.path()).map_err(|e|e.to_string())?;
    let dir_canon=fs::canonicalize(&cursor).map_err(|e|e.to_string())?;
    if !dir_canon.starts_with(root_canon){return Err("directory escaped isolated root".into())}
    Ok(cursor)
}

pub(crate) fn validate_selected_source(path:&Path)->Result<PathBuf,String>{
    reject_path_chain(path)?;
    let meta=fs::symlink_metadata(path).map_err(|e|e.to_string())?;
    if meta.file_type().is_symlink()||is_reparse(&meta)||!meta.is_file(){return Err("selected source must be a regular non-reparse file".into())}
    fs::canonicalize(path).map_err(|e|e.to_string())
}

fn nearest_existing(path: &Path) -> Result<&Path, String> {
    let mut current=path;
    loop {
        match fs::symlink_metadata(current) {
            Ok(meta) => { if meta.file_type().is_symlink() || is_reparse(&meta) { return Err("output ancestor is a symlink or reparse point".into()); } return Ok(current); },
            Err(error) if error.kind()==std::io::ErrorKind::NotFound => current=current.parent().ok_or_else(||"no existing ancestor".to_owned())?,
            Err(error)=>return Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub async fn finance_v2_environment_pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await.map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn finance_v2_source_pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_file())
        .await.map_err(|e| e.to_string())?;
    Ok(path.map(|p| p.to_string()))
}

#[tauri::command]
pub fn finance_v2_environment_create(app: tauri::AppHandle, parent_path: String) -> Result<FinanceV2Session, String> {
    let parent = canonical_selected_directory(&parent_path)?;
    reject_protected_root(&app, &parent)?;
    let workspace_id = Id::new();
    let identity = LedgerIdentity::new(format!("finance-v2:{}", Id::new().as_str())).map_err(|e| format!("invalid isolated identity: {e:?}"))?;
    let root_path = parent.join(format!("finance-v2-isolated-{}", workspace_id.as_str()));
    let root = create_isolated_store(&root_path, workspace_id.clone(), identity.clone())?;
    register_session(root, workspace_id, identity)
}

#[tauri::command]
pub fn finance_v2_environment_open(app: tauri::AppHandle, root_path: String) -> Result<FinanceV2Session, String> {
    let canonical = canonical_selected_directory(&root_path)?;
    reject_protected_root(&app, &canonical)?;
    let root = IsolatedWorkspaceRoot::open_existing(&canonical).map_err(|e| format!("not a valid isolated Finance v2 environment: {e:?}"))?;
    let connection = open_isolated_store(&root)?;
    let generation = current_generation(&connection)?;
    let session_id = Id::new().as_str().to_owned();
    let result = FinanceV2Session { session_id: session_id.clone(), root_path: root.path().to_string_lossy().into_owned(), workspace_id: root.workspace_id().clone(), ledger_identity: root.ledger_identity().clone(), marker_version: IsolatedWorkspaceRoot::MARKER_VERSION, scope: "isolated".into(), generation };
    sessions().lock().map_err(|_| "session registry unavailable".to_owned())?.insert(session_id, SessionRecord { root: root.path().to_owned(), workspace_id: root.workspace_id().clone(), ledger_identity: root.ledger_identity().clone() });
    Ok(result)
}

pub(crate) fn verify_session(app: &tauri::AppHandle, session: &FinanceV2Session) -> Result<IsolatedWorkspaceRoot, String> {
    if session.scope != "isolated" || session.marker_version != IsolatedWorkspaceRoot::MARKER_VERSION { return Err("invalid Finance v2 session scope or marker version".into()); }
    let record = sessions().lock().map_err(|_| "session registry unavailable".to_owned())?.get(&session.session_id).cloned().ok_or_else(|| "Finance v2 session is not active; explicitly reopen the selected environment".to_owned())?;
    if record.root.to_string_lossy() != session.root_path || record.workspace_id != session.workspace_id || record.ledger_identity != session.ledger_identity { return Err("Finance v2 session identity mismatch".into()); }
    reject_protected_root(app, &record.root)?;
    let root = IsolatedWorkspaceRoot::open(&record.root, &record.workspace_id, &record.ledger_identity).map_err(|e| format!("Finance v2 marker validation failed: {e:?}"))?;
    Ok(root)
}

pub(crate) fn open_store(root: &IsolatedWorkspaceRoot) -> Result<rusqlite::Connection, String> {
    let root_path = root.path();
    reject_path_chain(root_path).map_err(|e| format!("isolated database root path validation failed: {e}"))?;
    let db_path = root_path.join("finance-v2.sqlite3");
    match fs::symlink_metadata(&db_path) {
        Ok(meta) if meta.file_type().is_symlink() || is_reparse(&meta) || !meta.is_file() => return Err("SQLite path is not a regular isolated file".into()),
        Ok(_) => {},
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::OpenOptions::new().write(true).create_new(true).open(&db_path).map_err(|e| format!("cannot create isolated database: {e}"))?;
        },
        Err(e) => return Err(format!("cannot inspect isolated database path: {e}")),
    }
    let mut connection = rusqlite::Connection::open(&db_path).map_err(|e| format!("cannot open isolated database with SQLite: {e}"))?;
    connection.pragma_update(None, "foreign_keys", "ON").map_err(store_error)?;
    let meta = fs::symlink_metadata(&db_path).map_err(|e| format!("cannot revalidate isolated database path: {e}"))?;
    let canonical_db = fs::canonicalize(&db_path).map_err(|e| format!("cannot canonicalize isolated database path: {e}"))?;
    if meta.file_type().is_symlink() || is_reparse(&meta) || !meta.is_file() || canonical_db.parent() != Some(root_path) { return Err("SQLite file escaped isolated root".into()); }
    Ok(connection)
}

pub(crate) fn create_isolated_store(path: &Path, workspace_id: Id, identity: LedgerIdentity) -> Result<IsolatedWorkspaceRoot, String> {
    let root = IsolatedWorkspaceRoot::create(path, workspace_id, identity)
        .map_err(|e| format!("isolated environment marker/directory creation failed: {e:?}"))?;
    let mut connection = open_store(&root)?;
    let tx = connection.transaction().map_err(|e| format!("isolated database schema transaction could not start: {}", store_error(e)))?;
    schema::install(&tx).map_err(|e| format!("isolated database schema installation failed: {}", store_error(e)))?;
    tx.commit().map_err(|e| format!("isolated database schema commit failed: {}", store_error(e)))?;
    validate_isolated_schema(&connection)?;
    Ok(root)
}

pub(crate) fn open_isolated_store(root: &IsolatedWorkspaceRoot) -> Result<rusqlite::Connection, String> {
    let connection = open_store(root)?;
    validate_isolated_schema(&connection)?;
    Ok(connection)
}

fn validate_isolated_schema(connection: &rusqlite::Connection) -> Result<(), String> {
    if let Err(error) = schema::validate(connection) {
        #[cfg(feature = "finance-v2-test-support")]
        {
            let detail = schema::validation_diagnostics(connection)
                .map(|issues| if issues.is_empty() { "no structural mismatch identified".to_owned() } else { issues.join("; ") })
                .unwrap_or_else(|diagnostic_error| format!("diagnostics unavailable: {}", store_error(diagnostic_error)));
            return Err(format!("isolated database schema validation failed: {}; {}", store_error(error), detail));
        }
        #[cfg(not(feature = "finance-v2-test-support"))]
        {
            return Err(format!("isolated database schema validation failed: {}", store_error(error)));
        }
    }
    Ok(())
}

fn register_session(root: IsolatedWorkspaceRoot, workspace_id: Id, identity: LedgerIdentity) -> Result<FinanceV2Session, String> {
    let connection = open_isolated_store(&root)?;
    let generation = current_generation(&connection)?;
    let session_id = Id::new().as_str().to_owned();
    let session = FinanceV2Session { session_id: session_id.clone(), root_path: root.path().to_string_lossy().into_owned(), workspace_id: workspace_id.clone(), ledger_identity: identity.clone(), marker_version: IsolatedWorkspaceRoot::MARKER_VERSION, scope: "isolated".into(), generation };
    sessions().lock().map_err(|_| "session registry unavailable".to_owned())?.insert(session_id, SessionRecord { root: root.path().to_owned(), workspace_id, ledger_identity: identity });
    Ok(session)
}

pub(crate) fn current_generation(connection: &rusqlite::Connection) -> Result<u64, String> {
    connection.query_row("SELECT generation FROM finance_v2_ledger_state WHERE singleton=1", [], |r| r.get::<_, i64>(0)).map_err(store_error).and_then(|v| u64::try_from(v).map_err(|_| "invalid ledger generation".into()))
}

fn canonical_selected_directory(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    reject_path_chain(path)?;
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_dir() { return Err("selected path must be a directory".into()); }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

fn reject_protected_root(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let mut protected = Vec::new();
    if let Ok(path) = app.path().app_data_dir() { protected.push(path); }
    if let Ok(exe) = std::env::current_exe() { if let Some(parent) = exe.parent() { protected.push(parent.to_owned()); } }
    for path in protected {
        if let Ok(canonical) = fs::canonicalize(path) {
            if root == canonical || root.starts_with(&canonical) || canonical.starts_with(root) { return Err("selected environment overlaps protected application or data storage".into()); }
        }
    }
    Ok(())
}

pub(crate) fn reject_path_chain(path: &Path) -> Result<(), String> {
    if !path.is_absolute() && path.components().any(|component| matches!(component, Component::Prefix(_))) {
        return Err("drive-relative paths are not accepted; use an absolute canonical path".into());
    }
    let absolute = if path.is_absolute() { path.to_owned() } else { std::env::current_dir().map_err(|e|e.to_string())?.join(path) };
    let mut cursor = PathBuf::new();
    for component in absolute.components() {
        match component {
            // A Windows prefix such as `\\?\D:` is not a complete filesystem
            // path until its root separator is appended. Querying it alone can
            // fail with ERROR_INVALID_FUNCTION on Windows.
            Component::Prefix(prefix) => { cursor.push(prefix.as_os_str()); continue; }
            Component::RootDir => cursor.push(component.as_os_str()),
            Component::CurDir => continue,
            Component::ParentDir => { cursor.pop(); }
            Component::Normal(value) => cursor.push(value),
        }
        if !cursor.is_absolute() { continue; }
        match fs::symlink_metadata(&cursor) {
            Ok(meta) if meta.file_type().is_symlink() || is_reparse(&meta) => return Err("selected path traverses a symlink or reparse point".into()),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
    }
    if !cursor.is_absolute() { return Err("selected path is not absolute".into()); }
    Ok(())
}

#[cfg(windows)] fn is_reparse(meta: &fs::Metadata) -> bool { use std::os::windows::fs::MetadataExt; meta.file_attributes() & 0x0400 != 0 }
#[cfg(not(windows))] fn is_reparse(_meta: &fs::Metadata) -> bool { false }
fn store_error(error: impl std::fmt::Debug) -> String { format!("{error:?}") }
#[allow(dead_code)] fn _store_error_type(_: StoreError) {}


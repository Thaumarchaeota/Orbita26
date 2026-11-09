//! Explicit, bounded source-file intake. The Python bridge receives bytes only;
//! the selected path and isolated artifact storage remain Rust-owned.
use std::{
    fs::OpenOptions,
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    finance_v2_domain::{Id, LedgerSnapshot},
    finance_v2_source::{RawSourceField, RawSourceFieldValue, RawSourceRecord, SourceOccurrenceRef, SourceRowSnapshot},
    finance_v2_store::{
        accounts::read_account_via_snapshot,
        read::read_ledger_snapshot,
        schema,
        sources::{active_bindings, active_context_revision, list_contexts, register_artifact, SourceArtifact},
    },
    finance_v2_workspace::{
        AccountBinding, ObservationQuality, ObservationValue, ParseObservation, ParsedObservation,
        SourceRowEvidence,
    },
};

use super::{
    session::{ensure_root_directory, finance_v2_write_lock, guarded_root_path, open_store, validate_selected_source, verify_session, FinanceV2Session},
    wire::ParseArtifactRequest,
};

const MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 90 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_BRIDGE_SECONDS: u64 = 120;
const BRIDGE_VERSION: &str = "finance-v2-source/1";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseArtifactResponse {
    pub artifact: SourceArtifact,
    pub parse_result: Value,
    pub observations: Vec<ParsedObservation>,
    pub context_id: Id,
    pub context_revision: u64,
    pub binding_revision: u64,
}

#[derive(Debug)]
struct BridgeOutput { status: std::process::ExitStatus, stdout: Vec<u8>, overflow: bool }

#[tauri::command]
pub async fn finance_v2_parse_artifact(app: AppHandle, request: ParseArtifactRequest) -> Result<ParseArtifactResponse, String> {
    tauri::async_runtime::spawn_blocking(move || parse_artifact_inner(app, request))
        .await.map_err(|_| "source_parse_task_failed".to_owned())?
}

fn parse_artifact_inner(app: AppHandle, request: ParseArtifactRequest) -> Result<ParseArtifactResponse, String> {
    if !supported_profile(&request.profile_id, &request.profile_revision) {
        return Err("unsupported_profile_revision".into());
    }
    let _guard = finance_v2_write_lock()?;
    let root = verify_session(&app, &request.session)?;
    let selected = validate_selected_source(Path::new(&request.selected_path))?;
    let bytes = read_bounded_source(&selected)?;
    let detected_format = detect_format(&bytes);
    let artifact_id = Id::new();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let relative_path = format!("source-artifacts/{}/source.bin", artifact_id.as_str());
    ensure_root_directory(&root, &format!("source-artifacts/{}", artifact_id.as_str()))?;
    let stored_path = guarded_root_path(&root, &relative_path)?;
    write_new_synced(&stored_path, &bytes)?;

    let mut connection = open_store(&root)?;
    schema::validate(&connection).map_err(|_| "finance_schema_invalid")?;
    let tx = connection.transaction().map_err(|_| "finance_database_unavailable")?;
    let context_revision = active_context_revision(&tx, &request.context_id)
        .map_err(|_| "source_context_unavailable")?
        .ok_or_else(|| "source_context_not_found".to_owned())?;
    if context_revision != request.expected_context_revision {
        return Err("source_context_revision_changed".into());
    }
    let (_,contexts)=list_contexts(&tx).map_err(|_|"source_context_snapshot_unavailable")?;
    let context=contexts.into_iter().find(|c|c.id==request.context_id&&c.revision==context_revision&&c.active).ok_or_else(||"source_context_not_found".to_owned())?;
    let (binding_revision, bindings) = active_bindings(
        &tx, &request.context_id, context_revision, &request.profile_id, &request.profile_revision,
    ).map_err(|_| "source_binding_snapshot_unavailable")?;
    let (account_via_revision, account_via) = read_account_via_snapshot(&tx)
        .map_err(|_| "account_via_snapshot_unavailable")?;
    let ledger_snapshot=read_ledger_snapshot(&tx).map_err(|_|"ledger_snapshot_unavailable")?;
    let artifact = SourceArtifact {
        id: artifact_id.clone(), sha256: sha256.clone(), byte_length: bytes.len() as u64,
        media_type: detected_format.to_owned(), relative_path: relative_path.clone(),
        context_id: request.context_id.clone(), context_revision, binding_revision,
    };
    register_artifact(&tx, &artifact, chrono::Utc::now().timestamp_micros())
        .map_err(|_| "source_artifact_registration_failed")?;
    tx.commit().map_err(|_| "source_artifact_registration_failed")?;
    drop(_guard);

    let binding_snapshot = make_binding_snapshot(&bindings, binding_revision);
    let envelope = json!({
        "contract_version": BRIDGE_VERSION,
        "artifact_id": artifact_id.as_str(),
        "source_bytes_base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
        "detected_media_type": detected_format,
        "profile_id": &request.profile_id,
        "profile_revision": &request.profile_revision,
        "binding_snapshot": binding_snapshot,
    });
    let request_bytes = serde_json::to_vec(&envelope).map_err(|_| "source_request_encoding_failed")?;
    if request_bytes.len() > MAX_REQUEST_BYTES { return Err("source_request_too_large".into()); }
    let response_bytes = invoke_python_bridge(&request_bytes)?;
    let response: Value = serde_json::from_slice(&response_bytes).map_err(|_| "source_bridge_invalid_response")?;
    if response.get("contract_version").and_then(Value::as_str) != Some(BRIDGE_VERSION) {
        return Err("source_bridge_version_mismatch".into());
    }
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        let code = response.get("error").and_then(Value::as_str).unwrap_or("source_bridge_failed");
        return Err(format!("source_parse_failed:{code}"));
    }
    let parse_result = response.get("result").cloned().ok_or_else(|| "source_bridge_missing_result".to_owned())?;
    let observations = map_occurrences(
        &parse_result, &artifact, &request.profile_id, &request.profile_revision,
        binding_revision, &ledger_snapshot, &account_via, &context,
    )?;
    Ok(ParseArtifactResponse { artifact, parse_result, observations, context_id: request.context_id, context_revision, binding_revision })
}

fn supported_profile(profile: &str, revision: &str) -> bool {
    revision == "1" && matches!(profile,
        "wallet-csv-13/v1" | "wallet-xlsx-11/v1" | "credit-card-pdf-text-6/v1" |
        "cmb-bank-pdf-text-6/v1" | "boc-bank-pdf-text-12/v1")
}

fn detect_format(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"%PDF-") { "pdf" }
    else if bytes.starts_with(b"PK\x03\x04") { "xlsx" }
    else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) || std::str::from_utf8(bytes).is_ok() { "csv" }
    else { "unknown" }
}

fn read_bounded_source(path: &Path) -> Result<Vec<u8>, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)] {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(path).map_err(|_| "source_file_open_failed")?;
    let metadata = file.metadata().map_err(|_| "source_file_metadata_failed")?;
    if !metadata.is_file() || metadata.file_type().is_symlink() { return Err("source_file_not_regular".into()); }
    let mut bytes = Vec::new();
    file.take((MAX_SOURCE_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "source_file_read_failed")?;
    if bytes.len() > MAX_SOURCE_BYTES { return Err("source_file_too_large".into()); }
    Ok(bytes)
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| "source_artifact_write_failed")?;
    file.write_all(bytes).map_err(|_| "source_artifact_write_failed")?;
    file.sync_all().map_err(|_| "source_artifact_write_failed".to_owned())
}

fn make_binding_snapshot(bindings: &[crate::finance_v2_store::sources::SourceBinding], revision: u64) -> Value {
    let mut account = std::collections::BTreeMap::<String, Vec<String>>::new();
    let mut via = std::collections::BTreeMap::<String, Vec<String>>::new();
    let mut artifact_account = std::collections::BTreeSet::<String>::new();
    let mut artifact_via = std::collections::BTreeSet::<String>::new();
    for binding in bindings {
        match binding.field_alias.as_str() {
            "account_hint" => if let (Some(hint),Some(id)) = (&binding.source_hint,&binding.account_id) { account.entry(hint.clone()).or_default().push(id.as_str().to_owned()); },
            "via_hint" => if let (Some(hint),Some(id)) = (&binding.source_hint,&binding.via_id) { via.entry(hint.clone()).or_default().push(id.as_str().to_owned()); },
            "artifact_account" => if let Some(id) = &binding.account_id { artifact_account.insert(id.as_str().to_owned()); },
            "artifact_via" => if let Some(id) = &binding.via_id { artifact_via.insert(id.as_str().to_owned()); },
            _ => {}
        }
    }
    let account_pairs:Vec<(String,Vec<String>)>=account.into_iter().map(|(hint,mut ids)|{ids.sort();ids.dedup();(hint,ids)}).collect();
    let via_pairs:Vec<(String,Vec<String>)>=via.into_iter().map(|(hint,mut ids)|{ids.sort();ids.dedup();(hint,ids)}).collect();
    json!({ "revision": revision.to_string(), "account_hint_to_ids": account_pairs, "via_hint_to_ids": via_pairs,
        "artifact_account_ids": artifact_account.into_iter().collect::<Vec<_>>(), "artifact_via_ids": artifact_via.into_iter().collect::<Vec<_>>() })
}

fn invoke_python_bridge(request: &[u8]) -> Result<Vec<u8>, String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let py_root = manifest.join("../python").canonicalize().map_err(|_| "finance_python_runtime_missing")?;
    let python = py_root.join(".venv/Scripts/python.exe");
    if !python.is_file() { return Err("finance_python_runtime_missing".into()); }
    const LAUNCHER: &str = "import runpy,sys;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('finance_v2_adapters.bridge',run_name='__main__')";
    let mut command = Command::new(python);
    command.arg("-I").arg("-c").arg(LAUNCHER).arg(py_root.as_os_str())
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).env_clear();
    for key in ["SYSTEMROOT", "WINDIR"] { if let Some(value) = std::env::var_os(key) { command.env(key, value); } }
    let mut child = command.spawn().map_err(|_| "source_bridge_start_failed")?;
    let mut stdout = child.stdout.take().ok_or("source_bridge_start_failed")?;
    let mut stderr = child.stderr.take().ok_or("source_bridge_start_failed")?;
    let output_thread = thread::spawn(move || {
        let mut retained=Vec::with_capacity(64*1024);let mut chunk=[0u8;8192];let mut overflow=false;
        loop { match stdout.read(&mut chunk) { Ok(0)|Err(_) => break, Ok(n)=>{let room=MAX_RESPONSE_BYTES.saturating_sub(retained.len());if n>room{overflow=true;}retained.extend_from_slice(&chunk[..n.min(room)]);} } }
        (retained,overflow)
    });
    let stderr_thread = thread::spawn(move || { let mut sink=[0u8;8192]; while stderr.read(&mut sink).unwrap_or(0)>0 {} });
    let mut stdin=child.stdin.take().ok_or("source_bridge_start_failed")?;
    if stdin.write_all(request).is_err(){
        drop(stdin);let _=child.kill();let _=child.wait();let _=output_thread.join();let _=stderr_thread.join();
        return Err("source_bridge_input_failed".into())
    }
    drop(stdin);
    let started=Instant::now();
    let status=loop { match child.try_wait(){Ok(Some(status))=>break status,Ok(None)=>{},Err(_)=>{let _=child.kill();let _=child.wait();let _=output_thread.join();let _=stderr_thread.join();return Err("source_bridge_wait_failed".into())}}
        if started.elapsed()>Duration::from_secs(MAX_BRIDGE_SECONDS){let _=child.kill();let _=child.wait();let _=output_thread.join();let _=stderr_thread.join();return Err("source_bridge_timeout".into())}
        thread::sleep(Duration::from_millis(25));
    };
    let (stdout,overflow)=output_thread.join().map_err(|_|"source_bridge_output_failed")?;
    let _=stderr_thread.join();
    if overflow { return Err("source_bridge_output_too_large".into()); }
    if !status.success() { return Err("source_bridge_failed".into()); }
    Ok(stdout)
}

fn map_occurrences(
    result:&Value, artifact:&SourceArtifact, profile:&str, profile_revision:&str, binding_revision:u64,
    snapshot:&LedgerSnapshot, account_via:&[crate::finance_v2_store::accounts::AccountViaBinding], context:&crate::finance_v2_store::sources::SourceContext,
)->Result<Vec<ParsedObservation>,String>{
    let occurrences=result.get("occurrences").and_then(Value::as_array).ok_or_else(||"source_bridge_invalid_occurrences".to_owned())?;
    let mut out=Vec::with_capacity(occurrences.len());
    for row in occurrences {
        let locator=row.get("locator").and_then(Value::as_str).ok_or_else(||"source_bridge_invalid_locator".to_owned())?;
        let discriminator=row.get("occurrence_discriminator").and_then(Value::as_str).ok_or_else(||"source_bridge_invalid_discriminator".to_owned())?;
        let raw_fields=row.get("raw_fields").and_then(Value::as_array).ok_or_else(||"source_bridge_invalid_raw_fields".to_owned())?;
        let mut source_fields=Vec::with_capacity(raw_fields.len());let mut fields=Vec::with_capacity(raw_fields.len()+8);
        for raw in raw_fields {
            let name=raw.get("name").and_then(Value::as_str).ok_or_else(||"source_bridge_invalid_field".to_owned())?.to_owned();
            let kind=raw.get("value_kind").and_then(Value::as_str).unwrap_or("missing");
            let value=raw.get("value_text").and_then(Value::as_str).map(str::to_owned);
            let raw_value=match kind {"text"=>RawSourceFieldValue::Text(value.clone().unwrap_or_default()),"empty"=>RawSourceFieldValue::Empty,_=>RawSourceFieldValue::Missing};
            source_fields.push(RawSourceField::new(name.clone(),raw_value));
            let observation_value=match kind {"text"=>ObservationValue::Text(value.clone().unwrap_or_default()),"empty"=>ObservationValue::Text(String::new()),_=>ObservationValue::Missing};
            fields.push(ParseObservation{role:name,raw_text:value,value:observation_value,binding:None});
        }
        add_text_observations(row,"amount_observations","amount_text","role",&mut fields);
        add_text_observations(row,"date_observations","raw_text","role",&mut fields);
        add_text_observations(row,"external_ids","value_text","namespace",&mut fields);
        if let Some((binding,source_hint))=resolve_occurrence_binding(row,snapshot,account_via){
            fields.push(ParseObservation{role:"account_binding".into(),raw_text:source_hint.clone(),value:source_hint.map(ObservationValue::Text).unwrap_or(ObservationValue::Missing),binding:Some(binding.clone())});
            if row.get("via_binding").is_some_and(|v|!v.is_null()){
                fields.push(ParseObservation{role:"via_binding".into(),raw_text:None,value:ObservationValue::Missing,binding:Some(binding)});
            }
        }
        if let Some(value)=row.get("source_direction_text").and_then(Value::as_str){fields.push(text_observation("source_direction",value));}
        if let Some(value)=row.get("source_status_text").and_then(Value::as_str){fields.push(text_observation("source_status",value));}
        if let Some(formulas)=row.get("untrusted_observations").and_then(Value::as_array){for item in formulas{let role=item.get("semantic_role").and_then(Value::as_str).unwrap_or("unknown");let formula=item.get("formula_text").and_then(Value::as_str).unwrap_or("");fields.push(text_observation(&format!("untrusted_formula:{role}"),formula));}}
        let record=RawSourceRecord::Fields(source_fields);
        let source=SourceRowSnapshot::new(SourceOccurrenceRef::new(artifact.id.as_str(),locator,discriminator),profile,profile_revision,record).map_err(|_|"source_row_snapshot_invalid")?;
        let quality=match row.get("status").and_then(Value::as_str).unwrap_or("failure"){
            "success"=>ObservationQuality::Confirmed,
            "unresolved"=>ObservationQuality::Unresolved(row.get("failure_codes").map(Value::to_string).unwrap_or_else(||"unresolved".into())),
            _=>ObservationQuality::Failed(row.get("failure_codes").map(Value::to_string).unwrap_or_else(||"parse_failure".into())),
        };
        let source_row=SourceRowEvidence::from(&source);
        out.push(ParsedObservation{artifact_id:artifact.id.clone(),source_context_id:context.id.clone(),source_context_revision:context.revision,source_context_provider:context.provider.clone(),artifact_sha256:artifact.sha256.clone(),artifact_byte_length:artifact.byte_length,
            contract_id:BRIDGE_VERSION.into(),contract_revision:"1".into(),profile_id:profile.into(),profile_revision:profile_revision.into(),binding_revision,
            locator:locator.into(),occurrence_discriminator:discriminator.into(),source_row,fields,quality});
    }
    Ok(out)
}

fn add_text_observations(row:&Value,array_key:&str,value_key:&str,role_key:&str,fields:&mut Vec<ParseObservation>){
    if let Some(items)=row.get(array_key).and_then(Value::as_array){for item in items{let role=item.get(role_key).and_then(Value::as_str).unwrap_or(array_key);let value=item.get(value_key).and_then(Value::as_str).unwrap_or("");fields.push(text_observation(role,value));}}
}
fn text_observation(role:&str,value:&str)->ParseObservation{ParseObservation{role:role.to_owned(),raw_text:Some(value.to_owned()),value:ObservationValue::Text(value.to_owned()),binding:None}}

fn resolve_occurrence_binding(row:&Value,snapshot:&LedgerSnapshot,mappings:&[crate::finance_v2_store::accounts::AccountViaBinding])->Option<(AccountBinding,Option<String>)>{
    let account_value=row.get("account_binding").filter(|v|v.get("status").and_then(Value::as_str)==Some("matched"));
    let via_value=row.get("via_binding").filter(|v|v.get("status").and_then(Value::as_str)==Some("matched"));
    let account_id=account_value.and_then(|v|v.get("stable_id")).and_then(Value::as_str).and_then(|v|Id::parse(v.to_owned()).ok());
    let via_id=via_value.and_then(|v|v.get("stable_id")).and_then(Value::as_str).and_then(|v|Id::parse(v.to_owned()).ok());
    let account=account_id.as_ref().and_then(|id|snapshot.accounts.iter().find(|a|a.id==*id&&a.active));
    let via=via_id.as_ref().and_then(|id|snapshot.vias.iter().find(|v|v.id==*id&&v.active));
    let account=match (account,via){
        (Some(a),Some(v)) if mappings.iter().any(|m|m.active&&m.account_id==a.id&&m.via_id==v.id)=>Some(a),
        (Some(a),None)=>Some(a),
        (None,Some(v))=>{let mut matches=mappings.iter().filter(|m|m.active&&m.via_id==v.id).filter_map(|m|snapshot.accounts.iter().find(|a|a.id==m.account_id&&a.active));let first=matches.next()?;if matches.next().is_some(){return None}Some(first)},
        _=>None,
    }?;
    let source_hint=account_value.or(via_value).and_then(|v|v.get("source_hint")).and_then(Value::as_str).map(str::to_owned);
    Some((AccountBinding{account_id:Some(account.id.clone()),via_id:via_id.clone(),account_revision:Some(account.revision),via_revision:via.as_ref().map(|v|v.revision)},source_hint))
}

use rusqlite::{params, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};

use super::model::TravelMutationResult;
use super::super::error::{DomainError, DomainResult};
use super::super::util::utc_now;

pub fn hash_command(command_name: &str, envelope_json: &str) -> String {
    let raw = format!("{command_name}\n{envelope_json}");
    format!("{:x}", Sha256::digest(raw.as_bytes()))
}

pub fn lookup_receipt(
    tx: &Transaction<'_>,
    request_id: &str,
) -> DomainResult<Option<(String, TravelMutationResult)>> {
    let row = tx
        .query_row(
            "SELECT request_hash, result_json FROM productivity_travel_command_receipt WHERE request_id = ?1",
            [request_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    match row {
        Some((hash, json)) => {
            let result: TravelMutationResult = serde_json::from_str(&json)
                .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
            Ok(Some((hash, result)))
        }
        None => Ok(None),
    }
}

pub fn ensure_receipt(
    tx: &Transaction<'_>,
    request_id: &str,
    request_hash: &str,
    item_id: Option<&str>,
) -> DomainResult<Option<TravelMutationResult>> {
    if let Some((stored_hash, result)) = lookup_receipt(tx, request_id)? {
        if stored_hash != request_hash {
            return Err(DomainError::request_id_reused("requestId was used with a different payload"));
        }
        return Ok(Some(result));
    }
    Ok(None)
}

pub fn store_receipt(
    tx: &Transaction<'_>,
    request_id: &str,
    request_hash: &str,
    item_id: Option<&str>,
    result: &TravelMutationResult,
) -> DomainResult<()> {
    let now = utc_now();
    let json = serde_json::to_string(result).map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    tx.execute(
        "INSERT INTO productivity_travel_command_receipt (request_id, request_hash, item_id, result_json, created_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![request_id, request_hash, item_id, json, now],
    )
    .map_err(|e| DomainError::archive_lifecycle(e.to_string()))?;
    Ok(())
}

pub fn get_receipt(data_dir: &str, expected_data_dir: &str, request_id: &str) -> DomainResult<super::model::GetReceiptResponse> {
    let _ = data_dir;
    let mut response = super::super::coordinator::with_strict_read(expected_data_dir, |conn| {
        let Some(conn) = conn else {
            return Ok(super::model::GetReceiptResponse {
                status: "not_found".into(),
                result: None,
            });
        };
        super::super::coordinator::in_transaction(conn, |tx| {
            match lookup_receipt(tx, request_id)? {
                Some((_, result)) => Ok(super::model::GetReceiptResponse {
                    status: "ok".into(),
                    result: Some(result),
                }),
                None => Ok(super::model::GetReceiptResponse {
                    status: "not_found".into(),
                    result: None,
                }),
            }
        })
    })?;
    if let Some(result) = response.result.take() {
        response.result = Some(super::plan_history::finalize_result(expected_data_dir, request_id, result)?);
    }
    Ok(response)
}

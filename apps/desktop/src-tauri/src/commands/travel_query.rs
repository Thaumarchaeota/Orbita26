use std::time::Duration;

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const ENDPOINT: &str = "https://ai.variflight.com/servers/aviation/mcp";
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const MAX_FLIGHT_NUMBER_CHARS: usize = 32;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductivityTravelSourceRequest {
    #[serde(rename = "expectedDataDir")]
    expected_data_dir: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    fnum: String,
    date: String,
}

#[derive(Debug, Serialize)]
pub struct ProductivityTravelSourceResponse {
    request: TravelQueryRequest,
    #[serde(rename = "fetchedAtUtc")]
    fetched_at_utc: String,
    result: Value,
}

#[derive(Debug, Serialize)]
pub struct TravelQueryRequest {
    fnum: String,
    date: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcEnvelope {
    #[serde(default)]
    error: Option<Value>,
    #[serde(default)]
    result: Option<Value>,
}

fn stable_error(code: &'static str) -> String {
    code.to_owned()
}

fn validate_request(req: &ProductivityTravelSourceRequest) -> Result<(), String> {
    if req.expected_data_dir.trim().is_empty() {
        return Err(stable_error("travel_query_invalid_data_dir"));
    }
    if req.api_key.trim().is_empty() || req.api_key.chars().count() > 512 {
        return Err(stable_error("travel_query_invalid_api_key"));
    }
    if req.fnum.trim().is_empty() || req.fnum.chars().count() > MAX_FLIGHT_NUMBER_CHARS {
        return Err(stable_error("travel_query_invalid_fnum"));
    }
    if req.date.len() != 10
        || chrono::NaiveDate::parse_from_str(&req.date, "%Y-%m-%d").is_err()
    {
        return Err(stable_error("travel_query_invalid_date"));
    }
    Ok(())
}

fn parse_json_or_sse(body: &[u8]) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        return Ok(value);
    }

    let text = std::str::from_utf8(body).map_err(|_| stable_error("travel_query_invalid_response"))?;
    let mut parsed = None;
    for line in text.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            continue;
        }
        let value = serde_json::from_str::<Value>(data)
            .map_err(|_| stable_error("travel_query_invalid_response"))?;
        if value.get("error").is_some() {
            return Ok(value);
        }
        parsed = Some(value);
    }
    parsed.ok_or_else(|| stable_error("travel_query_invalid_response"))
}

fn extract_result(payload: Value) -> Result<Value, String> {
    let envelope: JsonRpcEnvelope = serde_json::from_value(payload)
        .map_err(|_| stable_error("travel_query_invalid_response"))?;
    if envelope.error.is_some() {
        return Err(stable_error("travel_query_jsonrpc_error"));
    }
    let result = envelope
        .result
        .ok_or_else(|| stable_error("travel_query_invalid_response"))?;
    if result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(stable_error("travel_query_business_error"));
    }
    reject_nested_business_code(&result)?;
    Ok(result)
}

fn verify_data_dir(
    app: &tauri::AppHandle,
    before: &str,
    expected: &str,
) -> Result<(), String> {
    let after = crate::data::get_data_dir(app)
        .map_err(|_| stable_error("travel_query_data_dir_unavailable"))?;
    if after != before || after != expected {
        return Err(stable_error("travel_query_data_dir_changed"));
    }
    Ok(())
}

fn reject_nested_business_code(value: &Value) -> Result<(), String> {
    match value {
        Value::Object(object) => {
            if let Some(code) = object.get("code") {
                let success = code.as_i64().map(|v| v == 0 || v == 200).unwrap_or(false)
                    || code
                        .as_str()
                        .map(|v| matches!(v, "0" | "200" | "OK" | "ok" | "SUCCESS" | "success"))
                        .unwrap_or(false);
                if !success {
                    return Err(stable_error("travel_query_business_error"));
                }
            }
            for child in object.values() {
                reject_nested_business_code(child)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                reject_nested_business_code(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

async fn read_bounded_response(response: reqwest::Response) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| stable_error("travel_query_transport_error"))?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(stable_error("travel_query_response_too_large"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn post_mcp(
    client: &reqwest::Client,
    api_key: &str,
    session_id: Option<&str>,
    request: Value,
) -> Result<(Value, Option<String>), String> {
    let mut builder = client
        .post(ENDPOINT)
        .header("X-API-Key", api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&request);
    if let Some(session_id) = session_id {
        builder = builder.header("Mcp-Session-Id", session_id);
    }
    let response = builder
        .send()
        .await
        .map_err(|_| stable_error("travel_query_transport_error"))?;
    if !response.status().is_success() {
        return Err(stable_error("travel_query_http_error"));
    }
    let session_id = response
        .headers()
        .get("Mcp-Session-Id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = read_bounded_response(response).await?;
    Ok((parse_json_or_sse(&body)?, session_id))
}

/// Lock-free Variflight lookup for travel v2; caller validates dataDir and context.
pub async fn variflight_search_by_number(
    api_key: &str,
    fnum: &str,
    date: &str,
) -> Result<(Value, String), String> {
    if api_key.trim().is_empty() || api_key.chars().count() > 512 {
        return Err(stable_error("travel_query_invalid_api_key"));
    }
    if fnum.trim().is_empty() || fnum.chars().count() > MAX_FLIGHT_NUMBER_CHARS {
        return Err(stable_error("travel_query_invalid_fnum"));
    }
    if date.len() != 10 || chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
        return Err(stable_error("travel_query_invalid_date"));
    }
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| stable_error("travel_query_client_error"))?;
    let (call, _) = post_mcp(
        &client,
        api_key,
        None,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "searchFlightsByNumber", "arguments": {"fnum": fnum, "date": date}}
        }),
    )
    .await?;
    let result = extract_result(call)?;
    Ok((result, chrono::Utc::now().to_rfc3339()))
}

/// SPEC-0007 §4/§7: this is an explicit, manually charged source lookup only;
/// the API key stays in memory for this call and is never persisted or logged.
///
/// VariFlight documents this endpoint as stateless streamable HTTP and shows a
/// direct JSON-RPC `tools/call`. It does not return `Mcp-Session-Id`, so requiring
/// that header failed every lookup with `travel_query_session_error` before the
/// paid call. https://ai.variflight.com/zh/docs/aviation
#[tauri::command]
pub async fn productivity_query_travel_source(
    app: tauri::AppHandle,
    req: ProductivityTravelSourceRequest,
) -> Result<ProductivityTravelSourceResponse, String> {
    validate_request(&req)?;
    let before = crate::data::get_data_dir(&app)
        .map_err(|_| stable_error("travel_query_data_dir_unavailable"))?;
    if before != req.expected_data_dir {
        return Err(stable_error("travel_query_data_dir_changed"));
    }

    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| stable_error("travel_query_client_error"))?;
    let call_result = post_mcp(
        &client,
        &req.api_key,
        None,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "searchFlightsByNumber", "arguments": {"fnum": &req.fnum, "date": &req.date}}
        }),
    )
    .await;
    verify_data_dir(&app, &before, &req.expected_data_dir)?;
    let (call, _) = call_result?;
    let result = extract_result(call)?;
    Ok(ProductivityTravelSourceResponse {
        request: TravelQueryRequest { fnum: req.fnum, date: req.date },
        fetched_at_utc: chrono::Utc::now().to_rfc3339(),
        result,
    })
}

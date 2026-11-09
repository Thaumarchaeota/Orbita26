use serde_json::Value;

pub fn extract_flight_candidates(result: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    collect_flight_records(result, &mut out);
    out.sort_by(|a, b| flight_key(a).cmp(&flight_key(b)));
    out.dedup_by(|a, b| flight_key(a) == flight_key(b));
    out
}

fn flight_key(record: &Value) -> String {
    let no = record
        .get("FlightNo")
        .or_else(|| record.get("flightNo"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let dep = record
        .get("FlightDepcode")
        .or_else(|| record.get("depCode"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let arr = record
        .get("FlightArrcode")
        .or_else(|| record.get("arrCode"))
        .and_then(Value::as_str)
        .unwrap_or("");
    format!("{no}:{dep}:{arr}")
}

fn collect_flight_records(value: &Value, out: &mut Vec<Value>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_flight_records(item, out);
            }
        }
        Value::String(text) => {
            if let Some(parsed) = parse_loose_structured_text(text) {
                collect_flight_records(&parsed, out);
            }
        }
        Value::Object(object) => {
            if object.contains_key("FlightNo") || object.contains_key("flightNo") {
                out.push(value.clone());
            }
            for key in ["records", "data", "flights", "result"] {
                if let Some(entry) = object.get(key) {
                    collect_flight_records(entry, out);
                }
            }
            if let Some(content) = object.get("content").and_then(Value::as_array) {
                for entry in content {
                    if let Some(text) = entry.get("text").and_then(Value::as_str) {
                        if let Some(parsed) = parse_loose_structured_text(text) {
                            collect_flight_records(&parsed, out);
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn parse_loose_structured_text(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    let start = trimmed.find(|c| c == '{' || c == '[');
    let candidates: Vec<&str> = if let Some(pos) = start {
        if pos > 0 {
            vec![trimmed, &trimmed[pos..]]
        } else {
            vec![trimmed]
        }
    } else {
        vec![trimmed]
    };
    for candidate in candidates {
        if let Ok(parsed) = serde_json::from_str::<Value>(candidate) {
            return Some(parsed);
        }
        let converted = python_literal_to_json(candidate);
        if let Ok(parsed) = serde_json::from_str::<Value>(&converted) {
            return Some(parsed);
        }
    }
    None
}

fn python_literal_to_json(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::new();
    let mut index = 0usize;
    while index < chars.len() {
        let quote = chars[index];
        if quote == '\'' || quote == '"' {
            index += 1;
            let mut raw = String::new();
            while index < chars.len() {
                let ch = chars[index];
                if ch == '\\' {
                    if index + 1 >= chars.len() {
                        break;
                    }
                    let next = chars[index + 1];
                    let decoded = match next {
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        other => other,
                    };
                    raw.push(decoded);
                    index += 2;
                    continue;
                }
                if ch == quote {
                    index += 1;
                    break;
                }
                raw.push(ch);
                index += 1;
            }
            if let Ok(encoded) = serde_json::to_string(&raw) {
                out.push_str(&encoded);
            } else {
                out.push_str("\"\"");
            }
            continue;
        }
        if quote == '_' || quote.is_ascii_alphabetic() {
            let start = index;
            index += 1;
            while index < chars.len() {
                let ch = chars[index];
                if ch.is_ascii_alphanumeric() || ch == '_' {
                    index += 1;
                } else {
                    break;
                }
            }
            let word: String = chars[start..index].iter().collect();
            let replacement = match word.as_str() {
                "None" => "null",
                "True" => "true",
                "False" => "false",
                other => other,
            };
            out.push_str(replacement);
            continue;
        }
        out.push(quote);
        index += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::extract_flight_candidates;
    use serde_json::json;

    #[test]
    fn extracts_from_mcp_python_literal_with_prefix() {
        let text = "Variflight: {'data': [{'FlightNo': 'MU5101', 'FlightDepcode': 'SHA', 'FlightArrcode': 'PEK'}]}";
        let result = json!({
            "content": [{ "type": "text", "text": text }]
        });
        let candidates = extract_flight_candidates(&result);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].get("FlightNo").and_then(|v| v.as_str()), Some("MU5101"));
        assert_eq!(
            candidates[0].get("FlightDepcode").and_then(|v| v.as_str()),
            Some("SHA")
        );
        assert_eq!(
            candidates[0].get("FlightArrcode").and_then(|v| v.as_str()),
            Some("PEK")
        );
    }

    #[test]
    fn preserves_utf8_airport_name_in_python_literal() {
        let text = "{'data': [{'FlightNo': 'MU5101', 'FlightDepAirport': '上海虹桥'}]}";
        let result = json!({
            "content": [{ "type": "text", "text": text }]
        });
        let candidates = extract_flight_candidates(&result);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].get("FlightNo").and_then(|v| v.as_str()), Some("MU5101"));
        assert_eq!(
            candidates[0].get("FlightDepAirport").and_then(|v| v.as_str()),
            Some("上海虹桥")
        );
    }

    #[test]
    fn extracts_from_strict_json_data_array() {
        let result = json!({
            "data": [{
                "FlightNo": "CA123",
                "FlightDepcode": "PEK",
                "FlightArrcode": "SHA"
            }]
        });
        let candidates = extract_flight_candidates(&result);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].get("FlightNo").and_then(|v| v.as_str()), Some("CA123"));
    }

    #[test]
    fn extracts_when_data_is_json_string_array() {
        let inner = json!([{
            "FlightNo": "MU8888",
            "FlightDepcode": "PVG",
            "FlightArrcode": "CAN"
        }]);
        let result = json!({
            "data": inner.to_string()
        });
        let candidates = extract_flight_candidates(&result);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].get("FlightNo").and_then(|v| v.as_str()), Some("MU8888"));
    }

    #[test]
    fn unparseable_text_yields_empty_vec() {
        let result = json!({
            "content": [{ "type": "text", "text": "not json or python {{{" }]
        });
        let candidates = extract_flight_candidates(&result);
        assert!(candidates.is_empty());
    }
}

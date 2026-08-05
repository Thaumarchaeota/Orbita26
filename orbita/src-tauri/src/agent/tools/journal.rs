use super::AgentTool;
use crate::journal::{
    self, beijing_today, build_journal_snapshot, datetime_to_unix_beijing, journal_delete,
    journal_list, journal_upsert, resolve_night_timestamps, JournalDeleteRequest, JournalListRequest,
    JournalUpsertRequest,
};
use serde_json::{json, Value};
use tauri::AppHandle;

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn ensure_journal(app: &AppHandle) -> Result<(), String> {
    journal::journal_root(app)?;
    if data_dir_missing(app) {
        return Err("请先在设置中配置数据存储位置".into());
    }
    Ok(())
}

fn data_dir_missing(app: &AppHandle) -> bool {
    crate::data::get_data_dir(app)
        .map(|d| d.trim().is_empty())
        .unwrap_or(true)
}

fn load_routine(app: &AppHandle, date: &str) -> Result<Option<Value>, String> {
    let res = journal_list(
        app,
        JournalListRequest {
            date: Some(date.to_string()),
            from: None,
            to: None,
        },
    )?;
    Ok(res
        .entries
        .into_iter()
        .find(|e| e.get("kind").and_then(|k| k.as_str()) == Some("routine")))
}

pub struct JournalList;

impl AgentTool for JournalList {
    fn name(&self) -> &str {
        "journal_list"
    }
    fn description(&self) -> &str {
        "查询生活记录（睡眠 routine、日汇总 daily、事件 event、心情 mood、运动 exercise）。\
         可指定 date（单日）或 from+to（区间）；kind 可选过滤。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string", "description": "YYYY-MM-DD，单日查询" },
                "from": { "type": "string", "description": "区间起始 YYYY-MM-DD" },
                "to": { "type": "string", "description": "区间结束 YYYY-MM-DD" },
                "kind": { "type": "string", "description": "routine|daily|event|mood|exercise" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在查询生活记录…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let res = journal_list(
            app,
            JournalListRequest {
                date: opt_str(&args, "date"),
                from: opt_str(&args, "from"),
                to: opt_str(&args, "to"),
            },
        )?;
        let kind = opt_str(&args, "kind");
        let entries: Vec<Value> = res
            .entries
            .into_iter()
            .filter(|e| {
                kind.as_ref().map_or(true, |k| {
                    e.get("kind").and_then(|v| v.as_str()) == Some(k.as_str())
                })
            })
            .collect();
        serde_json::to_string(&json!({ "entries": entries })).map_err(|e| e.to_string())
    }
}

pub struct JournalSnapshot;

impl AgentTool for JournalSnapshot {
    fn name(&self) -> &str {
        "journal_snapshot"
    }
    fn description(&self) -> &str {
        "获取某日生活摘要（睡眠时长、喝水、本周运动天数、事件/心情列表）。用于回答「今天怎么样」。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string", "description": "醒来日 YYYY-MM-DD，默认今天" }
            }
        })
    }
    fn start_label(&self) -> &str {
        "正在汇总今日生活数据…"
    }
    fn requires_confirm(&self) -> bool {
        false
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        let snap = build_journal_snapshot(app, opt_str(&args, "date").as_deref())?;
        serde_json::to_string(&snap).map_err(|e| e.to_string())
    }
}

pub struct JournalAddEvent;

impl AgentTool for JournalAddEvent {
    fn name(&self) -> &str {
        "journal_add_event"
    }
    fn description(&self) -> &str {
        "添加生活事件。date 为事件日期，默认今天。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "remark": { "type": "string", "description": "事件备注" }
            },
            "required": ["remark"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记录事件…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let remark = opt_str(&args, "remark").ok_or("remark 必填")?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let entry = json!({
            "kind": "event",
            "date": date,
            "remark": remark,
            "at": Value::Null,
        });
        let res = journal_upsert(app, JournalUpsertRequest { entry })?;
        serde_json::to_string(&res.entry).map_err(|e| e.to_string())
    }
}

pub struct JournalAddMood;

impl AgentTool for JournalAddMood {
    fn name(&self) -> &str {
        "journal_add_mood"
    }
    fn description(&self) -> &str {
        "记录心情（emoji + 可选简记）。date 默认今天。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "emoji": { "type": "string", "description": "单个 emoji" },
                "note": { "type": "string", "description": "简记" }
            },
            "required": ["emoji"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记录心情…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let emoji = opt_str(&args, "emoji").ok_or("emoji 必填")?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let note = opt_str(&args, "note").unwrap_or_default();
        let entry = json!({
            "kind": "mood",
            "date": date,
            "primary": false,
            "data": { "emoji": emoji, "note": note },
        });
        let res = journal_upsert(app, JournalUpsertRequest { entry })?;
        serde_json::to_string(&res.entry).map_err(|e| e.to_string())
    }
}

pub struct JournalSetSleep;

impl AgentTool for JournalSetSleep {
    fn name(&self) -> &str {
        "journal_set_sleep"
    }
    fn description(&self) -> &str {
        "记录夜间睡眠。date 为醒来日（北京时间）；sleepTime/wakeTime 为 HH:MM。\
         若入睡晚于醒来时刻（跨夜），入睡自动归到前一天。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string", "description": "醒来日 YYYY-MM-DD" },
                "sleepTime": { "type": "string", "description": "入睡 HH:MM" },
                "wakeTime": { "type": "string", "description": "醒来 HH:MM" }
            },
            "required": ["sleepTime", "wakeTime"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记录睡眠…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let sleep_time = opt_str(&args, "sleepTime").ok_or("sleepTime 必填")?;
        let wake_time = opt_str(&args, "wakeTime").ok_or("wakeTime 必填")?;
        let (sleep_ts, wake_ts) = resolve_night_timestamps(&date, &sleep_time, &wake_time)?;

        let mut data = json!({ "naps": [] });
        if let Some(existing) = load_routine(app, &date)? {
            if let Some(old) = existing.get("data") {
                data = old.clone();
                if !data.get("naps").is_some() {
                    data["naps"] = json!([]);
                }
            }
        }
        data["night"] = json!({
            "sleep": sleep_ts,
            "wake": wake_ts,
            "source": "manual",
        });

        let mut entry = json!({
            "kind": "routine",
            "date": date,
            "tz": "Asia/Shanghai",
            "data": data,
        });
        if let Some(existing) = load_routine(app, &date)? {
            if let Some(id) = existing.get("id") {
                entry["id"] = id.clone();
            }
        }
        let res = journal_upsert(app, JournalUpsertRequest { entry })?;
        serde_json::to_string(&res.entry).map_err(|e| e.to_string())
    }
}

pub struct JournalAddNap;

impl AgentTool for JournalAddNap {
    fn name(&self) -> &str {
        "journal_add_nap"
    }
    fn description(&self) -> &str {
        "添加午睡记录。date 默认今天；startTime/endTime 为 HH:MM（同日）。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "startTime": { "type": "string" },
                "endTime": { "type": "string" }
            },
            "required": ["startTime", "endTime"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记录午睡…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let start_time = opt_str(&args, "startTime").ok_or("startTime 必填")?;
        let end_time = opt_str(&args, "endTime").ok_or("endTime 必填")?;
        let start_ts = datetime_to_unix_beijing(&date, &start_time)?;
        let end_ts = datetime_to_unix_beijing(&date, &end_time)?;
        if end_ts <= start_ts {
            return Err("结束时间须晚于开始时间".into());
        }

        let mut data = json!({ "naps": [] });
        if let Some(existing) = load_routine(app, &date)? {
            if let Some(old) = existing.get("data") {
                data = old.clone();
            }
        }
        let mut naps = data
            .get("naps")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        naps.push(json!({ "start": start_ts, "end": end_ts }));
        data["naps"] = Value::Array(naps);

        let mut entry = json!({
            "kind": "routine",
            "date": date,
            "tz": "Asia/Shanghai",
            "data": data,
        });
        if let Some(existing) = load_routine(app, &date)? {
            if let Some(id) = existing.get("id") {
                entry["id"] = id.clone();
            }
        }
        let res = journal_upsert(app, JournalUpsertRequest { entry })?;
        serde_json::to_string(&res.entry).map_err(|e| e.to_string())
    }
}

pub struct JournalDeleteEntry;

impl AgentTool for JournalDeleteEntry {
    fn name(&self) -> &str {
        "journal_delete_entry"
    }
    fn description(&self) -> &str {
        "按 id 删除生活记录条目（事件/心情等）。id 来自 journal_list。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "journal/YYYY.json:uuid" }
            },
            "required": ["id"]
        })
    }
    fn start_label(&self) -> &str {
        "准备删除记录…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let id = opt_str(&args, "id").ok_or("id 必填")?;
        journal_delete(app, JournalDeleteRequest { id: id.clone() })?;
        Ok(json!({ "deleted": id }).to_string())
    }
}

fn normalize_meal_slot(raw: &str) -> String {
    match raw.trim() {
        "breakfast" | "lunch" | "dinner" | "snack" => raw.trim().to_string(),
        _ => "snack".into(),
    }
}

fn load_daily_for_date(app: &AppHandle, date: &str) -> Result<Option<Value>, String> {
    let res = journal_list(
        app,
        JournalListRequest {
            date: Some(date.to_string()),
            from: None,
            to: None,
        },
    )?;
    Ok(res
        .entries
        .into_iter()
        .find(|e| e.get("kind").and_then(|k| k.as_str()) == Some("daily")))
}

fn upsert_daily_meals(
    app: &AppHandle,
    date: &str,
    meals: Vec<Value>,
    existing: Option<Value>,
) -> Result<Value, String> {
    let mut data = json!({});
    if let Some(ex) = &existing {
        if let Some(d) = ex.get("data") {
            data = d.clone();
        }
    }
    data["meals"] = Value::Array(meals);
    let mut entry = json!({
        "kind": "daily",
        "date": date,
        "data": data,
    });
    if let Some(ex) = existing {
        if let Some(id) = ex.get("id") {
            entry["id"] = id.clone();
        }
    }
    let res = journal_upsert(app, JournalUpsertRequest { entry })?;
    Ok(res.entry)
}

pub struct JournalAddMeal;

impl AgentTool for JournalAddMeal {
    fn name(&self) -> &str {
        "journal_add_meal"
    }
    fn description(&self) -> &str {
        "用户描述进食或要记吃饭时必须调用。kcal 可估计（不确定填 confidence: low）；slot 为 breakfast/lunch/dinner/snack；items 为食物列表。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "slot": { "type": "string" },
                "items": { "type": "array", "items": { "type": "string" } },
                "text": { "type": "string" },
                "kcal": { "type": "number" },
                "at": { "type": "string", "description": "HH:MM" },
                "confidence": { "type": "string", "enum": ["low", "medium", "high"] }
            },
            "required": ["kcal"]
        })
    }
    fn start_label(&self) -> &str {
        "准备记录吃饭…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let kcal = args
            .get("kcal")
            .and_then(|v| v.as_i64())
            .filter(|v| *v >= 0)
            .ok_or("kcal 必填")?;
        let slot = normalize_meal_slot(opt_str(&args, "slot").as_deref().unwrap_or("snack"));
        let text = opt_str(&args, "text").unwrap_or_default();
        let items: Vec<Value> = args
            .get("items")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| Value::String(s.trim().to_string())))
                    .filter(|s| !s.as_str().unwrap_or("").is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let at = opt_str(&args, "at");
        let confidence = opt_str(&args, "confidence");
        let existing = load_daily_for_date(app, &date)?;
        let mut meals = existing
            .as_ref()
            .and_then(|e| e.get("data"))
            .and_then(|d| d.get("meals"))
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        let mut meal = json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "slot": slot,
            "kcal": kcal,
            "items": items,
            "text": text,
            "source": "ai_estimate",
        });
        if let Some(a) = at {
            meal["at"] = json!(a);
        }
        if let Some(c) = confidence {
            meal["confidence"] = json!(c);
        }
        meals.push(meal);
        let entry = upsert_daily_meals(app, &date, meals, existing)?;
        serde_json::to_string(&entry).map_err(|e| e.to_string())
    }
}

pub struct JournalUpdateMeal;

impl AgentTool for JournalUpdateMeal {
    fn name(&self) -> &str {
        "journal_update_meal"
    }
    fn description(&self) -> &str {
        "更新吃饭记录。id 来自 journal_list 当日 daily.data.meals。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "id": { "type": "string" },
                "slot": { "type": "string" },
                "items": { "type": "array", "items": { "type": "string" } },
                "text": { "type": "string" },
                "kcal": { "type": "number" },
                "at": { "type": "string" }
            },
            "required": ["id"]
        })
    }
    fn start_label(&self) -> &str {
        "准备更新吃饭记录…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let id = opt_str(&args, "id").ok_or("id 必填")?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let existing = load_daily_for_date(app, &date)?;
        let mut meals = existing
            .as_ref()
            .and_then(|e| e.get("data"))
            .and_then(|d| d.get("meals"))
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        let idx = meals
            .iter()
            .position(|m| m.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
            .ok_or("未找到吃饭记录")?;
        let mut meal = meals[idx].clone();
        if let Some(s) = opt_str(&args, "slot") {
            meal["slot"] = json!(normalize_meal_slot(&s));
        }
        if let Some(t) = opt_str(&args, "text") {
            meal["text"] = json!(t);
        }
        if let Some(k) = args.get("kcal").and_then(|v| v.as_i64()) {
            meal["kcal"] = json!(k);
        }
        if let Some(a) = opt_str(&args, "at") {
            meal["at"] = json!(a);
        }
        if let Some(items) = args.get("items").and_then(|v| v.as_array()) {
            meal["items"] = json!(
                items
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            );
        }
        meals[idx] = meal;
        let entry = upsert_daily_meals(app, &date, meals, existing)?;
        serde_json::to_string(&entry).map_err(|e| e.to_string())
    }
}

pub struct JournalDeleteMeal;

impl AgentTool for JournalDeleteMeal {
    fn name(&self) -> &str {
        "journal_delete_meal"
    }
    fn description(&self) -> &str {
        "删除吃饭记录。id 来自 daily.data.meals。"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string" },
                "id": { "type": "string" }
            },
            "required": ["id"]
        })
    }
    fn start_label(&self) -> &str {
        "准备删除吃饭记录…"
    }
    fn requires_confirm(&self) -> bool {
        true
    }
    fn execute(&self, app: &AppHandle, args: Value) -> Result<String, String> {
        ensure_journal(app)?;
        let id = opt_str(&args, "id").ok_or("id 必填")?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let existing = load_daily_for_date(app, &date)?;
        let meals = existing
            .as_ref()
            .and_then(|e| e.get("data"))
            .and_then(|d| d.get("meals"))
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();
        let before = meals.len();
        let kept: Vec<Value> = meals
            .into_iter()
            .filter(|m| m.get("id").and_then(|v| v.as_str()) != Some(id.as_str()))
            .collect();
        if kept.len() == before {
            return Err("未找到吃饭记录".into());
        }
        let entry = upsert_daily_meals(app, &date, kept, existing)?;
        serde_json::to_string(&entry).map_err(|e| e.to_string())
    }
}

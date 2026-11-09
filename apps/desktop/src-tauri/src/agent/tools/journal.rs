use super::AgentTool;

use crate::health_db::{self, CreateMealRequest, DeleteMealRequest, FoodInput, MealRef, UpdateMealRequest, UpdateMealMetadataRequest};

use crate::journal::{
    beijing_now_hhmm, beijing_today, build_journal_snapshot_in, datetime_to_unix_beijing,
    journal_delete, journal_list_in, journal_upsert, resolve_night_timestamps, JournalDeleteRequest,
    JournalListRequest, JournalUpsertRequest,
};

use serde_json::{json, Value};
use chrono::Timelike;

use tauri::AppHandle;



fn opt_str(args: &Value, key: &str) -> Option<String> {

    args.get(key)

        .and_then(|v| v.as_str())

        .map(str::trim)

        .filter(|s| !s.is_empty())

        .map(str::to_string)

}

fn present_nullable_str(args: &Value, key: &str) -> Option<Option<String>> {
    args.get(key).map(|value| value.as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}



fn ensure_journal(data_dir: &str) -> Result<(), String> {

    if data_dir.trim().is_empty() {

        return Err("请先在设置中配置数据存储位置".into());

    }

    Ok(())

}



fn parse_kcal(v: &Value) -> Option<i64> {

    let n = v

        .as_i64()

        .or_else(|| v.as_f64().map(|f| f.round() as i64))?;

    if n >= 0 {

        Some(n)

    } else {

        None

    }

}



fn load_sleep(data_dir: &str, date: &str) -> Result<Option<Value>, String> {

    let res = journal_list_in(

        data_dir,

        JournalListRequest {

            date: Some(date.to_string()),

            from: None,

            to: None,

        },

    )?;

    Ok(res

        .entries

        .into_iter()

        .find(|e| e.get("kind").and_then(|k| k.as_str()) == Some("sleep")))

}



pub struct JournalList;



impl AgentTool for JournalList {

    fn name(&self) -> &str {

        "journal_list"

    }

    fn description(&self) -> &str {

        "查询 Archive 生活记录（note、document、meal、sleep、activity、nap）。\

         可指定 date（单日）或 from+to（区间）；kind 可选过滤。"

    }

    fn parameters(&self) -> Value {

        json!({

            "type": "object",

            "properties": {

                "date": { "type": "string", "description": "YYYY-MM-DD，单日查询" },

                "from": { "type": "string", "description": "区间起始 YYYY-MM-DD" },

                "to": { "type": "string", "description": "区间结束 YYYY-MM-DD" },

                "kind": { "type": "string", "description": "note|document|meal|sleep|activity|nap" }

            }

        })

    }

    fn start_label(&self) -> &str {

        "正在查询生活记录…"

    }

    fn requires_confirm(&self) -> bool {

        false

    }

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let res = journal_list_in(

            data_dir,

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

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let snap = build_journal_snapshot_in(data_dir, opt_str(&args, "date").as_deref())?;

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

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let remark = opt_str(&args, "remark").ok_or("remark 必填")?;

        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);

        let entry = json!({

            "kind": "event",

            "date": date,

            "remark": remark,

            "at": Value::Null,

        });

        let res = journal_upsert(

            _app,

            JournalUpsertRequest { entry },

        )?;

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

    fn execute(&self, app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

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

    fn execute(&self, app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);

        let sleep_time = opt_str(&args, "sleepTime").ok_or("sleepTime 必填")?;

        let wake_time = opt_str(&args, "wakeTime").ok_or("wakeTime 必填")?;

        if let Some(existing) = load_sleep(data_dir, &date)? {

            let source = existing

                .get("source")

                .and_then(|s| s.as_str())

                .or_else(|| {

                    existing

                        .get("night")

                        .and_then(|n| n.get("source"))

                        .and_then(|s| s.as_str())

                });

            if source == Some("garmin") {

                return Err("该日已有佳明睡眠，无法手动覆盖".into());

            }

        }

        let (sleep_ts, wake_ts) = resolve_night_timestamps(&date, &sleep_time, &wake_time)?;



        let mut data = json!({ "naps": [] });

        if let Some(existing) = load_sleep(data_dir, &date)? {

            if let Some(old) = existing.get("night") {

                data = json!({ "night": old.clone(), "naps": [] });

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

        if let Some(existing) = load_sleep(data_dir, &date)? {

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

    fn execute(&self, app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);

        let start_time = opt_str(&args, "startTime").ok_or("startTime 必填")?;

        let end_time = opt_str(&args, "endTime").ok_or("endTime 必填")?;

        let start_ts = datetime_to_unix_beijing(&date, &start_time)?;

        let end_ts = datetime_to_unix_beijing(&date, &end_time)?;

        if end_ts <= start_ts {

            return Err("结束时间须晚于开始时间".into());

        }



        let mut data = json!({ "naps": [] });

        if let Some(existing) = load_sleep(data_dir, &date)? {

            if let Some(old) = existing.get("night") {

                data = json!({ "night": old.clone(), "naps": [] });

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

        if let Some(existing) = load_sleep(data_dir, &date)? {

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

                "id": { "type": "string", "description": "条目 id（UUID，来自 journal_list）" }

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

    fn execute(&self, app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {

        ensure_journal(data_dir)?;

        let id = opt_str(&args, "id").ok_or("id 必填")?;

        journal_delete(app, JournalDeleteRequest { id: id.clone() })?;

        Ok(json!({ "deleted": id }).to_string())

    }

}



fn slot_label(slot: &str) -> &'static str {

    match slot {

        "breakfast" => "早餐",

        "lunch" => "午餐",

        "dinner" => "晚餐",

        "late_night" => "夜宵",

        "coffee" => "咖啡",

        "beverage" => "饮料",

        "snack" => "零食",

        "other" => "其他",

        _ => "其他餐食",

    }

}



fn default_meal_title(date: &str, slot: Option<&str>) -> String {
    match slot {
        Some(slot) => format!("{} {}", date, slot_label(slot)),
        None => format!("{} 饮食记录", date),
    }
}



fn json_nonneg(v: Option<&Value>) -> Result<Option<f64>, String> {
    let Some(v) = v else {
        return Ok(None);
    };
    if v.is_null() {
        return Ok(None);
    }
    let n = if let Some(f) = v.as_f64() {
        f
    } else if let Some(i) = v.as_i64() {
        i as f64
    } else if let Some(u) = v.as_u64() {
        u as f64
    } else if let Some(s) = v.as_str() {
        s.trim().parse::<f64>().map_err(|_| "数值无效".to_string())?
    } else {
        return Err("数值无效".into());
    };
    if !n.is_finite() || n < 0.0 {
        return Err("数值必须有限且 ≥0".into());
    }
    Ok(Some(n))
}

fn parse_agent_food(v: &Value) -> Result<FoodInput, String> {
    let obj = v.as_object().ok_or("食物必须是对象")?;
    let text = obj
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        return Err("食物文字不能为空".into());
    }
    let kcal = json_nonneg(obj.get("kcal"))?.ok_or("食物热量必填")?;
    let kcal_estimated = obj
        .get("kcalEstimated")
        .and_then(|v| v.as_bool())
        .ok_or("kcalEstimated 必填")?;
    let serving_text = obj
        .get("servingText")
        .and_then(|t| t.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let serving_estimated = if serving_text.is_some() {
        Some(
            obj.get("servingEstimated")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    } else {
        None
    };
    let carbs_grams = json_nonneg(obj.get("carbsGrams"))?;
    let protein_grams = json_nonneg(obj.get("proteinGrams"))?;
    let fat_grams = json_nonneg(obj.get("fatGrams"))?;
    let sugar_grams = json_nonneg(obj.get("sugarGrams"))?;
    let fiber_grams = json_nonneg(obj.get("fiberGrams"))?;
    let sodium_milligrams = json_nonneg(obj.get("sodiumMilligrams"))?;
    let vitamin_c_milligrams = json_nonneg(obj.get("vitaminCMilligrams"))?;
    let any_nutrient = [
        carbs_grams,
        protein_grams,
        fat_grams,
        sugar_grams,
        fiber_grams,
        sodium_milligrams,
        vitamin_c_milligrams,
    ]
    .iter()
    .any(|v| v.is_some());
    let nutrients_estimated = if any_nutrient {
        Some(
            obj.get("nutrientsEstimated")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        )
    } else {
        None
    };
    Ok(FoodInput {
        text,
        kcal,
        kcal_estimated,
        serving_text,
        serving_estimated,
        carbs_grams,
        protein_grams,
        fat_grams,
        sugar_grams,
        fiber_grams,
        sodium_milligrams,
        vitamin_c_milligrams,
        nutrients_estimated,
    })
}

// Insight 餐食只认 foods。不把 items 与整餐 kcal 折叠成一条食物，避免第二套可编辑热量真值。
fn parse_agent_foods(args: &Value) -> Result<Vec<FoodInput>, String> {
    match args.get("foods") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => items.iter().map(parse_agent_food).collect(),
        Some(_) => Err("foods 必须是数组".into()),
    }
}

fn meal_text(args: &Value) -> Option<String> {
    opt_str(args, "text")
}

fn meal_started_at(date: &str, at: &str) -> Result<String, String> {
    let ts = datetime_to_unix_beijing(date, at)?;
    Ok(crate::health_db::util::unix_to_instant(ts))
}

pub struct JournalAddMeal;

impl AgentTool for JournalAddMeal {
    fn name(&self) -> &str {
        "journal_add_meal"
    }

    fn description(&self) -> &str {
        "记录一条餐食并等待确认。date 为 YYYY-MM-DD，at 为 HH:MM。slot 为 breakfast/lunch/dinner/snack。title 可空。text 是整餐备注，不是食物名。foods 可为空数组；有食物时每条含 text、kcal（有限且≥0）、kcalEstimated，可选份量与营养素。多种食物用多条 foods；只有用户明确给出合计且未分项时才合并成一条。不要猜份量。无法估算热量时省略 kcal，不要填 0。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "date": { "type": "string", "description": "YYYY-MM-DD" },
                "at": { "type": "string", "description": "HH:MM，单一时刻" },
                "slot": { "type": ["string", "null"], "enum": ["breakfast", "lunch", "dinner", "late_night", "coffee", "beverage", "snack", "other", null] },
                "title": { "type": "string" },
                "text": { "type": "string", "description": "整餐备注，不是食物名称" },
                "foods": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string" },
                            "kcal": { "type": "number" },
                            "kcalEstimated": { "type": "boolean" },
                            "servingText": { "type": "string" },
                            "servingEstimated": { "type": "boolean" },
                            "carbsGrams": { "type": "number" },
                            "proteinGrams": { "type": "number" },
                            "fatGrams": { "type": "number" },
                            "sugarGrams": { "type": "number" },
                            "fiberGrams": { "type": "number" },
                            "sodiumMilligrams": { "type": "number" },
                            "vitaminCMilligrams": { "type": "number" },
                            "nutrientsEstimated": { "type": "boolean" }
                        },
                        "required": ["text"]
                    }
                }
            },
            "required": []
        })
    }

    fn start_label(&self) -> &str {
        "准备记录吃饭…"
    }

    fn requires_confirm(&self) -> bool {
        true
    }

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        ensure_journal(data_dir)?;
        let date = opt_str(&args, "date").unwrap_or_else(beijing_today);
        let at = opt_str(&args, "at");
        let slot = opt_str(&args, "slot");
        let title = opt_str(&args, "title").unwrap_or_else(|| default_meal_title(&date, slot.as_deref()));
        // A date-only meal remains date-only in the projection; midnight is its
        // storage anchor, never an asserted meal time (SPEC-0009).
        let started_at = meal_started_at(&date, at.as_deref().unwrap_or("00:00"))?;
        let foods = parse_agent_foods(&args)?;
        let res = health_db::create_meal(
            data_dir,
            CreateMealRequest {
                title,
                started_at,
                slot,
                icon_key: None,
                text: meal_text(&args),
                foods,
                source: Some("manual".into()),
                at_hm: at,
            },
        )?;
        serde_json::to_string(&res.meal).map_err(|e| e.to_string())
    }
}

pub struct JournalUpdateMeal;

impl AgentTool for JournalUpdateMeal {
    fn name(&self) -> &str {
        "journal_update_meal"
    }

    fn description(&self) -> &str {
        "更新一条餐食。id 必填。仅改标题、分类、备注时省略 foods；只有明确修改食物明细时才传 foods（空数组表示清空）。未提供的字段保持原值。不要传 expectedRevision。必须等确认。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "date": { "type": "string", "description": "YYYY-MM-DD" },
                "at": { "type": "string", "description": "HH:MM，单一时刻" },
                "updateTime": { "type": "boolean", "description": "明确设为 true 才更新日期或时间；未提供时由 date/at 是否提供决定" },
                "slot": { "type": ["string", "null"], "enum": ["breakfast", "lunch", "dinner", "late_night", "coffee", "beverage", "snack", "other", null] },
                "title": { "type": "string" },
                "text": { "type": "string", "description": "整餐备注，不是食物名称" },
                "foods": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": { "type": "string" },
                            "kcal": { "type": "number" },
                            "kcalEstimated": { "type": "boolean" },
                            "servingText": { "type": "string" },
                            "servingEstimated": { "type": "boolean" },
                            "carbsGrams": { "type": "number" },
                            "proteinGrams": { "type": "number" },
                            "fatGrams": { "type": "number" },
                            "sugarGrams": { "type": "number" },
                            "fiberGrams": { "type": "number" },
                            "sodiumMilligrams": { "type": "number" },
                            "vitaminCMilligrams": { "type": "number" },
                            "nutrientsEstimated": { "type": "boolean" }
                        },
                        "required": ["text"]
                    }
                }
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

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        ensure_journal(data_dir)?;
        let id = opt_str(&args, "id").ok_or("id 必填")?;
        let existing = health_db::get_meal(data_dir, &id)?;
        let meal = &existing.meal;
        if meal.deleted_at.is_some() {
            return Err("餐食已删除".into());
        }
        let meal_ref = MealRef { id: id.clone(), expected_revision: meal.revision };
        let has_foods = args.get("foods").is_some_and(|value| !value.is_null());
        if !has_foods {
            let title = present_nullable_str(&args, "title");
            let date_was_supplied = args.get("date").is_some_and(|value| !value.is_null());
            let at_was_supplied = args.get("at").is_some();
            let update_time = args.get("updateTime")
                .and_then(Value::as_bool)
                .unwrap_or(date_was_supplied || at_was_supplied);
            let (started_at, at_hm) = if update_time {
                let local = chrono::DateTime::parse_from_rfc3339(&meal.started_at)
                    .map_err(|e| format!("餐食时间异常: {e}"))?
                    .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).expect("valid Beijing offset"));
                let date = opt_str(&args, "date")
                    .unwrap_or_else(|| local.format("%Y-%m-%d").to_string());
                let next_at_hm = if at_was_supplied {
                    opt_str(&args, "at")
                } else {
                    meal.at_hm.clone()
                };
                let started_at = match next_at_hm.as_deref() {
                    Some(at) if !at_was_supplied && date == local.format("%Y-%m-%d").to_string() => meal.started_at.clone(),
                    Some(at) => {
                        let minute = meal_started_at(&date, at)?;
                        let instant = chrono::DateTime::parse_from_rfc3339(&minute)
                            .map_err(|e| format!("餐食时间异常: {e}"))?;
                        let seconds = if at_was_supplied { 0 } else { local.second() };
                        (instant + chrono::Duration::seconds(i64::from(seconds))).to_rfc3339()
                    }
                    None => meal_started_at(&date, "00:00")?,
                };
                (Some(started_at), Some(next_at_hm))
            } else {
                (None, None)
            };
            let res = health_db::update_meal_metadata(data_dir, UpdateMealMetadataRequest {
                expected_data_dir: data_dir.to_string(),
                meal: meal_ref,
                title,
                slot: present_nullable_str(&args, "slot"),
                icon_key: present_nullable_str(&args, "iconKey"),
                text: present_nullable_str(&args, "text"),
                update_time,
                started_at,
                at_hm,
            })?;
            return serde_json::to_string(&res.meal).map_err(|e| e.to_string());
        }

        let local = chrono::DateTime::parse_from_rfc3339(&meal.started_at)
            .map_err(|e| format!("餐食时间异常: {e}"))?
            .with_timezone(&chrono::FixedOffset::east_opt(8 * 3600).expect("valid Beijing offset"));
        let date_arg = opt_str(&args, "date");
        let at_arg = opt_str(&args, "at");
        let at_present = args.get("at").is_some();
        let update_time = args.get("updateTime").and_then(Value::as_bool)
            .unwrap_or(date_arg.is_some() || at_present);
        // The complete-food command cannot distinguish an omitted atHm from
        // null; refuse this combination instead of silently retaining time.
        if update_time && at_present && at_arg.is_none() {
            return Err("请先单独清除餐食时间，再修改食物明细".into());
        }
        let date = if update_time { date_arg.clone() } else { None }
            .unwrap_or_else(|| local.format("%Y-%m-%d").to_string());
        let at = if update_time { at_arg.clone() } else { None }
            .or_else(|| meal.at_hm.clone()).unwrap_or_else(|| local.format("%H:%M").to_string());
        let started_at = match (update_time && date_arg.is_some(), update_time && at_arg.is_some()) {
            (false, false) => meal.started_at.clone(),
            (true, false) => {
                let minute = meal_started_at(&date, &at)?;
                let parsed = chrono::DateTime::parse_from_rfc3339(&minute)
                    .map_err(|e| format!("餐食时间异常: {e}"))?;
                (parsed + chrono::Duration::seconds(i64::from(local.second())))
                    .format("%Y-%m-%dT%H:%M:%SZ").to_string()
            }
            (false, true) | (true, true) => meal_started_at(&date, &at)?,
        };
        let slot = present_nullable_str(&args, "slot");
        let slot_for_title = slot.as_ref().map(|value| value.as_deref()).unwrap_or(meal.slot.as_deref());
        let title = opt_str(&args, "title")
            .or_else(|| meal.title.clone())
            .unwrap_or_else(|| default_meal_title(&date, slot_for_title));
        let text = present_nullable_str(&args, "text").unwrap_or_else(|| meal.text.clone());
        let at_hm = if update_time { at_arg.or_else(|| meal.at_hm.clone()) } else { meal.at_hm.clone() };
        let foods = parse_agent_foods(&args)?;
        let res = health_db::update_meal(data_dir, UpdateMealRequest {
            meal: meal_ref,
            title,
            started_at,
            slot,
            icon_key: present_nullable_str(&args, "iconKey").or_else(|| Some(meal.icon_key.clone())),
            text,
            foods,
            at_hm,
        })?;
        serde_json::to_string(&res.meal).map_err(|e| e.to_string())
    }
}

pub struct JournalDeleteMeal;

impl AgentTool for JournalDeleteMeal {
    fn name(&self) -> &str {
        "journal_delete_meal"
    }

    fn description(&self) -> &str {
        "仅当用户明确要求删除某一条餐食时调用。只传 id。必须等确认框展示该餐内容且用户确认后才执行。不要用 health_apply_ai_batch 删除。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
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

    fn execute(&self, _app: &AppHandle, data_dir: &str, args: Value) -> Result<String, String> {
        ensure_journal(data_dir)?;
        let id = opt_str(&args, "id").ok_or("id 必填")?;
        let existing = health_db::get_meal(data_dir, &id)?;
        if existing.meal.deleted_at.is_some() {
            return Err("餐食已删除".into());
        }
        let res = health_db::delete_meal(
            data_dir,
            DeleteMealRequest {
                meal: MealRef {
                    id: id.clone(),
                    expected_revision: existing.meal.revision,
                },
            },
        )?;
        serde_json::to_string(&res.meal).map_err(|e| e.to_string())
    }
}

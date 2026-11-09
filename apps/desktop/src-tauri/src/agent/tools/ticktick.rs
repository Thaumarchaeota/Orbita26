use super::AgentTool;
use crate::data::read_settings;
use crate::ticktick::{
    self, TicktickCreateTaskRequest, TicktickFilterTasksRequest, TicktickUpdateTaskRequest,
};
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, Weekday};
use serde_json::{json, Value};
use tauri::AppHandle;

fn ensure_connected(app: &AppHandle) -> Result<(), String> {
    let settings = read_settings(app)?;
    if settings.integrations.ticktick.access_token.trim().is_empty() {
        return Err("未连接滴答清单，请先在设置 → 任务中授权".into());
    }
    Ok(())
}

fn default_project_id(settings: &crate::data::AppSettings) -> String {
    let id = settings.integrations.ticktick.default_project_id.trim();
    if id.is_empty() {
        "inbox".to_string()
    } else {
        id.to_string()
    }
}

pub fn local_now_line() -> String {
    let now = Local::now();
    let weekday = match now.weekday() {
        Weekday::Mon => "周一",
        Weekday::Tue => "周二",
        Weekday::Wed => "周三",
        Weekday::Thu => "周四",
        Weekday::Fri => "周五",
        Weekday::Sat => "周六",
        Weekday::Sun => "周日",
    };
    format!(
        "当前本地时间：{} {}（{}）",
        now.format("%Y-%m-%d %H:%M:%S"),
        weekday,
        now.format("%:z")
    )
}

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn opt_i32(args: &Value, key: &str) -> Option<i32> {
    args.get(key).and_then(|v| v.as_i64()).map(|n| n as i32)
}

fn task_due_on_raw(task: &Value) -> Option<String> {
    task.get("dueDate").and_then(|v| v.as_str()).and_then(|s| {
        if s.len() >= 10 {
            Some(s[..10].to_string())
        } else {
            None
        }
    })
}

fn norm_hm(text: &str) -> Option<String> {
    let text = text.trim();
    let (h, m) = if let Some((h, m)) = text.split_once(':') {
        (h, m)
    } else if text.len() <= 2 {
        (text, "00")
    } else {
        return None;
    };
    let hour: u32 = h.parse().ok()?;
    let minute: u32 = m.parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(format!("{hour:02}:{minute:02}"))
}

fn task_due_time(task: &Value) -> Option<String> {
    let s = task.get("dueDate")?.as_str()?;
    if s.len() >= 16 && s.as_bytes().get(10) == Some(&b'T') {
        return norm_hm(&s[11..16]);
    }
    None
}

fn task_due_at(task: &Value) -> Option<String> {
    let on = task_due_on_raw(task)?;
    let tm = task_due_time(task)?;
    Some(format!("{on} {tm}"))
}

fn task_due_on(task: &Value) -> Option<String> {
    task_due_on_raw(task)
}

fn format_local_iso(date: NaiveDate, time: NaiveTime) -> Result<String, String> {
    let dt = date
        .and_time(time)
        .and_local_timezone(Local)
        .single()
        .ok_or_else(|| "无效日期时间".to_string())?;
    let offset = dt.offset().local_minus_utc();
    let sign = if offset >= 0 { '+' } else { '-' };
    let abs = offset.abs();
    Ok(format!(
        "{}{}{:02}{:02}",
        dt.format("%Y-%m-%dT%H:%M:%S"),
        sign,
        abs / 3600,
        (abs % 3600) / 60
    ))
}

fn due_on_to_end_of_day(due_on: &str) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(due_on, "%Y-%m-%d")
        .map_err(|_| format!("日期格式应为 YYYY-MM-DD，收到：{due_on}"))?;
    format_local_iso(date, NaiveTime::from_hms_opt(23, 59, 0).unwrap())
}

fn due_on_time_to_iso(due_on: &str, due_time: &str) -> Result<String, String> {
    let date = NaiveDate::parse_from_str(due_on, "%Y-%m-%d")
        .map_err(|_| format!("日期格式应为 YYYY-MM-DD，收到：{due_on}"))?;
    let hm = norm_hm(due_time).ok_or_else(|| format!("时间格式应为 HH:MM，收到：{due_time}"))?;
    let time = NaiveTime::parse_from_str(&hm, "%H:%M").map_err(|_| format!("无效时间：{due_time}"))?;
    format_local_iso(date, time)
}

fn task_due_time_from_iso(s: &str) -> Option<String> {
    if s.len() >= 16 && s.as_bytes().get(10) == Some(&b'T') {
        return norm_hm(&s[11..16]);
    }
    None
}

fn task_start_on_from_str(s: &str) -> Option<String> {
    if s.len() >= 10 {
        Some(s[..10].to_string())
    } else {
        None
    }
}

fn task_start_time_from_str(s: &str) -> Option<String> {
    task_due_time_from_iso(s)
}

fn start_after_due(start_iso: &str, due_iso: &str) -> bool {
    let so = start_iso.get(..10).unwrap_or("");
    let du = due_iso.get(..10).unwrap_or("");
    if so > du {
        return true;
    }
    if so == du {
        let st = task_start_time_from_str(start_iso);
        let dt = task_due_time_from_iso(due_iso);
        if let (Some(a), Some(b)) = (st, dt) {
            return a > b;
        }
    }
    false
}

fn resolve_start_date_for_update(
    task: &Value,
    args: &Value,
    new_due_iso: Option<&str>,
) -> Result<Option<String>, String> {
    if let Some(d) = opt_str(args, "startDate") {
        return Ok(Some(d));
    }
    if let Some(on) = opt_str(args, "startOn") {
        if let Some(t) = opt_str(args, "startTime") {
            return Ok(Some(due_on_time_to_iso(&on, &t)?));
        }
        return Ok(Some(due_on_to_end_of_day(&on)?));
    }

    let new_due = match new_due_iso {
        Some(d) => d,
        None => {
            return Ok(task
                .get("startDate")
                .and_then(|v| v.as_str())
                .map(str::to_string));
        }
    };

    let old_start_str = task
        .get("startDate")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    if old_start_str.is_none() {
        return Ok(None);
    }
    let old_start_str = old_start_str.unwrap();

    let new_due_on = new_due[..10].to_string();
    if let Some(old_due_on) = task_due_on(task) {
        let old_due_date = NaiveDate::parse_from_str(&old_due_on, "%Y-%m-%d")
            .map_err(|_| format!("无效原截止日期：{old_due_on}"))?;
        let new_due_date = NaiveDate::parse_from_str(&new_due_on, "%Y-%m-%d")
            .map_err(|_| format!("无效新截止日期：{new_due_on}"))?;
        let old_start_on = task_start_on_from_str(old_start_str)
            .ok_or_else(|| format!("无效原开始日期：{old_start_str}"))?;
        let old_start_date = NaiveDate::parse_from_str(&old_start_on, "%Y-%m-%d")
            .map_err(|_| format!("无效原开始日期：{old_start_on}"))?;

        let day_delta = (new_due_date - old_due_date).num_days();
        let new_start_date = old_start_date + Duration::days(day_delta);
        let start_time = task_start_time_from_str(old_start_str)
            .or_else(|| task_due_time_from_iso(new_due))
            .unwrap_or_else(|| "09:00".to_string());

        let mut start_iso =
            due_on_time_to_iso(&new_start_date.format("%Y-%m-%d").to_string(), &start_time)?;
        if start_after_due(&start_iso, new_due) {
            start_iso = new_due.to_string();
        }
        return Ok(Some(start_iso));
    }

    Ok(Some(new_due.to_string()))
}

fn resolve_due_date(args: &Value, due_on_key: &str, due_time_key: &str, due_date_key: &str) -> Result<Option<String>, String> {
    if let Some(d) = opt_str(args, due_date_key) {
        return Ok(Some(d));
    }
    let due_on = match opt_str(args, due_on_key) {
        Some(d) => d,
        None => return Ok(None),
    };
    if let Some(t) = opt_str(args, due_time_key) {
        Ok(Some(due_on_time_to_iso(&due_on, &t)?))
    } else {
        Ok(Some(due_on_to_end_of_day(&due_on)?))
    }
}

fn list_incomplete_tasks(app: &AppHandle) -> Result<Vec<Value>, String> {
    let tasks = tauri::async_runtime::block_on(ticktick::ticktick_filter_tasks(
        app.clone(),
        TicktickFilterTasksRequest {
            project_ids: None,
            start_date: None,
            end_date: None,
        },
    ))?;
    Ok(match tasks {
        Value::Array(items) => items,
        _ => vec![],
    })
}

fn is_task_overdue(task: &Value) -> bool {
    let Some(due_on) = task_due_on(task) else {
        return false;
    };
    let Ok(date) = NaiveDate::parse_from_str(&due_on, "%Y-%m-%d") else {
        return false;
    };
    date < Local::now().date_naive()
}

fn task_summary(task: &Value) -> Value {
    json!({
        "id": task.get("id"),
        "title": task.get("title"),
        "dueOn": task_due_on(task),
        "dueTime": task_due_time(task),
        "dueAt": task_due_at(task),
        "startOn": task.get("startDate").and_then(|v| v.as_str()).and_then(task_start_on_from_str),
        "startTime": task.get("startDate").and_then(|v| v.as_str()).and_then(task_start_time_from_str),
        "isOverdue": is_task_overdue(task),
        "projectId": task.get("projectId"),
    })
}

fn filter_by_title(tasks: &[Value], query: &str) -> Vec<Value> {
    let query_lc = query.to_lowercase();
    tasks
        .iter()
        .filter(|t| {
            t.get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_lowercase() == query_lc)
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

fn filter_by_due_on(tasks: Vec<Value>, due_on: &str) -> Vec<Value> {
    tasks
        .into_iter()
        .filter(|t| task_due_on(t).as_deref() == Some(due_on))
        .collect()
}

fn filter_by_due_time(tasks: Vec<Value>, due_time: &str) -> Result<Vec<Value>, String> {
    let want = norm_hm(due_time).ok_or_else(|| format!("时间格式应为 HH:MM，收到：{due_time}"))?;
    Ok(tasks
        .into_iter()
        .filter(|t| task_due_time(t).as_deref() == Some(want.as_str()))
        .collect())
}

fn ambiguous_error(matches: &[Value]) -> String {
    let candidates: Vec<Value> = matches.iter().map(task_summary).collect();
    serde_json::to_string(&json!({
        "ok": false,
        "code": "ambiguous_tasks",
        "message": "找到多条同名任务。请先向用户列出下列 dueOn/dueTime（及 isOverdue），请其确认要操作哪几条，再分别用 taskDueOn+taskDueTime 调用 update/delete；勿猜测、勿新建。",
        "candidates": candidates,
    }))
    .unwrap_or_else(|_| format!("找到 {} 条匹配任务", matches.len()))
}

fn resolve_task_inner(app: &AppHandle, args: &Value) -> Result<Value, String> {
    if let Some(task_id) = opt_str(args, "taskId") {
        for task in list_incomplete_tasks(app)? {
            if task.get("id").and_then(|v| v.as_str()) == Some(task_id.as_str()) {
                return Ok(task);
            }
        }
        return Err(format!("未找到任务 id={task_id}"));
    }

    let query = opt_str(args, "taskTitle").ok_or("缺少 taskId 或 taskTitle")?;
    let mut matches = filter_by_title(&list_incomplete_tasks(app)?, &query);

    if let Some(due_on) = opt_str(args, "taskDueOn") {
        matches = filter_by_due_on(matches, &due_on);
        if matches.is_empty() {
            return Err(format!("未找到标题「{query}」且日期为 {due_on} 的任务"));
        }
    }

    if let Some(due_time) = opt_str(args, "taskDueTime") {
        matches = filter_by_due_time(matches, &due_time)?;
        if matches.is_empty() {
            return Err(format!("未找到标题「{query}」且时间为 {due_time} 的任务"));
        }
    }

    match matches.len() {
        0 => Err(format!("未找到标题为「{query}」的未完成任务")),
        1 => Ok(matches.into_iter().next().unwrap()),
        _ => Err(ambiguous_error(&matches)),
    }
}

fn resolve_task(app: &AppHandle, args: &Value) -> Result<Value, String> {
    match resolve_task_inner(app, args) {
        Ok(task) => Ok(task),
        Err(err)
            if (opt_str(args, "taskDueOn").is_some() || opt_str(args, "taskDueTime").is_some())
                && (err.contains("未找到") || err.contains("匹配任务")) =>
        {
            let mut retry = args.clone();
            if let Some(obj) = retry.as_object_mut() {
                obj.remove("taskDueOn");
                obj.remove("taskDueTime");
            }
            resolve_task_inner(app, &retry)
        }
        Err(err) => Err(err),
    }
}

fn task_id(task: &Value) -> Result<String, String> {
    task.get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "任务缺少 id".into())
}

fn task_project_id(task: &Value) -> Result<String, String> {
    task.get("projectId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "任务缺少 projectId".into())
}

pub struct TicktickListTasks;

impl AgentTool for TicktickListTasks {
    fn name(&self) -> &str {
        "ticktick_list_tasks"
    }

    fn description(&self) -> &str {
        "列出滴答未完成任务（含 id、标题、dueAt）。修改/删除前可先查询；可按标题、日期、时间筛选。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "按标题精确筛选（可选）" },
                "dueOn": { "type": "string", "description": "按日期 YYYY-MM-DD 筛选（可选）" },
                "dueTime": { "type": "string", "description": "按时间 HH:MM 筛选（可选）" }
            }
        })
    }

    fn start_label(&self) -> &str {
        "滴答 · 查询任务"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        ensure_connected(app)?;
        let mut tasks = list_incomplete_tasks(app)?;
        if let Some(title) = opt_str(&args, "title") {
            tasks = filter_by_title(&tasks, &title);
        }
        if let Some(due_on) = opt_str(&args, "dueOn") {
            tasks = filter_by_due_on(tasks, &due_on);
        }
        if let Some(due_time) = opt_str(&args, "dueTime") {
            tasks = filter_by_due_time(tasks, &due_time)?;
        }
        let items: Vec<Value> = tasks.iter().map(task_summary).collect();
        Ok(json!({ "ok": true, "tasks": items }).to_string())
    }
}

pub struct TicktickCreateTask;

impl AgentTool for TicktickCreateTask {
    fn name(&self) -> &str {
        "ticktick_create_task"
    }

    fn description(&self) -> &str {
        "在滴答清单创建一条新任务。仅在用户明确要求记录、提醒或待办时调用。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "description": "任务标题" },
                "content": { "type": "string", "description": "任务备注（可选）" },
                "dueOn": { "type": "string", "description": "截止日期 YYYY-MM-DD（明天/后天须按当前本地时间换算）" },
                "dueTime": { "type": "string", "description": "截止时间 HH:MM（如 09:00；有具体时间时必填）" },
                "dueDate": { "type": "string", "description": "完整截止 ISO 8601（可选，一般用 dueOn+dueTime）" },
                "priority": { "type": "integer", "description": "优先级：0 无，1 低，3 中，5 高（可选）" }
            },
            "required": ["title"]
        })
    }

    fn start_label(&self) -> &str {
        "滴答 · 创建任务"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        ensure_connected(app)?;
        let settings = read_settings(app)?;
        let project_id = default_project_id(&settings);

        let title = opt_str(&args, "title").ok_or("缺少 title")?;

        let due_date = resolve_due_date(&args, "dueOn", "dueTime", "dueDate")?;

        let existing = filter_by_title(&list_incomplete_tasks(app)?, &title);
        if existing.len() > 1 {
            return Err(ambiguous_error(&existing));
        }
        if existing.len() == 1 {
            let task = &existing[0];
            if is_task_overdue(task) && due_date.is_some() {
                let task_id = task_id(task)?;
                let project_id = task_project_id(task)?;
                let start_date = resolve_start_date_for_update(task, &args, due_date.as_deref())?;
                let content = opt_str(&args, "content").or_else(|| {
                    task.get("content")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                });
                let priority = opt_i32(&args, "priority").or_else(|| {
                    task.get("priority").and_then(|v| v.as_i64()).map(|n| n as i32)
                });
                let time_zone = task
                    .get("timeZone")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let is_all_day = task.get("isAllDay").and_then(|v| v.as_bool());
                let req = TicktickUpdateTaskRequest {
                    title: title.clone(),
                    project_id,
                    content,
                    start_date,
                    due_date,
                    time_zone,
                    is_all_day,
                    priority,
                };
                tauri::async_runtime::block_on(ticktick::ticktick_update_task(
                    app.clone(),
                    task_id,
                    req,
                ))?;
                return Ok(json!({ "ok": true, "title": title, "rescheduled": true }).to_string());
            }
        }

        let req = TicktickCreateTaskRequest {
            title: title.clone(),
            project_id,
            content: opt_str(&args, "content"),
            start_date: None,
            due_date,
            time_zone: None,
            is_all_day: None,
            priority: opt_i32(&args, "priority"),
        };

        tauri::async_runtime::block_on(ticktick::ticktick_create_task(app.clone(), req))?;
        Ok(json!({ "ok": true, "title": title }).to_string())
    }
}

pub struct TicktickUpdateTask;

impl AgentTool for TicktickUpdateTask {
    fn name(&self) -> &str {
        "ticktick_update_task"
    }

    fn description(&self) -> &str {
        "修改滴答清单中已有任务。用 taskTitle+原 taskDueOn+taskDueTime 定位；改截止日期时 startDate 会随 due 同步平移（无额外指示时与 due 对齐）。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "任务 ID" },
                "taskTitle": { "type": "string", "description": "当前任务标题（定位用）" },
                "taskDueOn": { "type": "string", "description": "当前任务日期 YYYY-MM-DD（同名/同天时必填）" },
                "taskDueTime": { "type": "string", "description": "当前任务时间 HH:MM（同天多条时必填，如 09:00）" },
                "title": { "type": "string", "description": "新标题（可选）" },
                "content": { "type": "string", "description": "新备注（可选）" },
                "dueOn": { "type": "string", "description": "新截止日期 YYYY-MM-DD（可选）" },
                "dueTime": { "type": "string", "description": "新截止时间 HH:MM（可选）" },
                "dueDate": { "type": "string", "description": "新完整截止 ISO（可选）" },
                "startDate": { "type": "string", "description": "新开始 ISO（可选；未填时改 due 会自动平移 start）" },
                "startOn": { "type": "string", "description": "新开始日期 YYYY-MM-DD（可选）" },
                "startTime": { "type": "string", "description": "新开始时间 HH:MM（可选，配合 startOn）" },
                "priority": { "type": "integer", "description": "新优先级：0 无，1 低，3 中，5 高（可选）" }
            }
        })
    }

    fn start_label(&self) -> &str {
        "滴答 · 修改任务"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        ensure_connected(app)?;
        let task = resolve_task(app, &args)?;
        let task_id = task_id(&task)?;
        let project_id = task_project_id(&task)?;

        let title = opt_str(&args, "title")
            .or_else(|| task.get("title").and_then(|v| v.as_str()).map(str::to_string))
            .ok_or("任务缺少标题")?;

        let content = if args.get("content").is_some() {
            opt_str(&args, "content")
        } else {
            task.get("content")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };

        let due_date = if args.get("dueDate").is_some()
            || args.get("dueOn").is_some()
            || args.get("dueTime").is_some()
        {
            resolve_due_date(&args, "dueOn", "dueTime", "dueDate")?
        } else {
            task.get("dueDate")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };

        let priority = if args.get("priority").is_some() {
            opt_i32(&args, "priority")
        } else {
            task.get("priority").and_then(|v| v.as_i64()).map(|n| n as i32)
        };

        let start_date = if args.get("dueDate").is_some()
            || args.get("dueOn").is_some()
            || args.get("dueTime").is_some()
            || args.get("startDate").is_some()
            || args.get("startOn").is_some()
            || args.get("startTime").is_some()
        {
            resolve_start_date_for_update(&task, &args, due_date.as_deref())?
        } else {
            task.get("startDate")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };
        let time_zone = task
            .get("timeZone")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let is_all_day = task.get("isAllDay").and_then(|v| v.as_bool());

        let req = TicktickUpdateTaskRequest {
            title: title.clone(),
            project_id,
            content,
            start_date,
            due_date,
            time_zone,
            is_all_day,
            priority,
        };

        tauri::async_runtime::block_on(ticktick::ticktick_update_task(
            app.clone(),
            task_id,
            req,
        ))?;
        Ok(json!({ "ok": true, "title": title }).to_string())
    }
}

pub struct TicktickDeleteTask;

impl AgentTool for TicktickDeleteTask {
    fn name(&self) -> &str {
        "ticktick_delete_task"
    }

    fn description(&self) -> &str {
        "删除滴答清单中的任务。用 taskTitle+原 taskDueOn+taskDueTime 定位；同名多条时须先向用户确认要删哪几条。"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string", "description": "任务 ID" },
                "taskTitle": { "type": "string", "description": "任务标题（定位用）" },
                "taskDueOn": { "type": "string", "description": "任务日期 YYYY-MM-DD（同名/同天时必填）" },
                "taskDueTime": { "type": "string", "description": "任务时间 HH:MM（同天多条时必填）" }
            }
        })
    }

    fn start_label(&self) -> &str {
        "滴答 · 删除任务"
    }

    fn execute(&self, app: &AppHandle, _data_dir: &str, args: Value) -> Result<String, String> {
        ensure_connected(app)?;
        let task = resolve_task(app, &args)?;
        let task_id = task_id(&task)?;
        let project_id = task_project_id(&task)?;
        let title = task
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&task_id)
            .to_string();

        tauri::async_runtime::block_on(ticktick::ticktick_delete_task(
            app.clone(),
            project_id,
            task_id,
        ))?;
        Ok(json!({ "ok": true, "title": title }).to_string())
    }
}

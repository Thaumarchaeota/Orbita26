import base64
import hashlib
import json
from datetime import datetime, timezone

PARSER_VERSION = 2

METRIC_CLASS = {
    "hr": "health_day_sample_hr",
    "stress": "health_day_sample_stress",
    "body_battery": "health_day_sample_body_battery",
    "spo2": "health_day_sample_spo2",
    "respiration": "health_day_sample_respiration",
    "hrv": "health_day_sample_hrv",
    "steps_cumulative": "health_day_sample_steps",
}

METRIC_ARCHIVE = {
    "hr": "heartRate",
    "stress": "stress",
    "body_battery": "bodyBattery",
    "spo2": "spo2",
    "respiration": "respiration",
    "hrv": "hrv",
    "steps_cumulative": "steps",
}


def _hash_obj(obj) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _iso_utc(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _entry(class_id, local_date, completeness, payload=None, external_id=None, error_code=None, error_summary=None):
    out = {
        "classId": class_id,
        "localDate": local_date,
        "completeness": completeness,
    }
    if external_id:
        out["externalId"] = str(external_id)
    if completeness == "complete" and payload is not None:
        out["contentHash"] = _hash_obj(payload)
        out["parserVersion"] = PARSER_VERSION
        out["payload"] = payload
    if error_code:
        out["errorCode"] = error_code
    if error_summary:
        out["errorSummary"] = error_summary
    return out


def _map_daily_summary(daily):
    data = daily.get("data") or {}
    if not data:
        return _entry("health_day_summary", daily["date"], "empty")
    payload = {}
    if data.get("restingHr") is not None:
        payload["restingHeartRateBpm"] = data["restingHr"]
    if data.get("steps") is not None:
        payload["totalSteps"] = data["steps"]
    if data.get("totalCalories") is not None:
        payload["totalCaloriesKcal"] = data["totalCalories"]
    if data.get("activeCalories") is not None:
        payload["activeCaloriesKcal"] = data["activeCalories"]
    if data.get("hydrationMl") is not None:
        payload["hydrationMl"] = data["hydrationMl"]
    bb = data.get("bodyBattery")
    if isinstance(bb, dict):
        if bb.get("low") is not None:
            payload["bodyBatteryLow"] = bb["low"]
        if bb.get("high") is not None:
            payload["bodyBatteryHigh"] = bb["high"]
    if data.get("avgStress") is not None:
        payload["avgStress"] = data["avgStress"]
    if data.get("spo2Avg") is not None:
        payload["avgSpO2Percent"] = data["spo2Avg"]
    if not payload:
        return _entry("health_day_summary", daily["date"], "empty")
    return _entry("health_day_summary", daily["date"], "complete", payload)


def _map_series_entry(snap):
    metric = snap.get("metric")
    class_id = METRIC_CLASS.get(metric)
    if not class_id:
        return None
    samples_raw = snap.get("samples") or []
    samples = []
    for s in samples_raw:
        if isinstance(s, dict):
            t = s.get("t")
            v = s.get("v")
            if t is None:
                continue
            item = {"at": _iso_utc(int(t)), "value": v}
            samples.append(item)
    if not samples:
        return _entry(class_id, snap["localDate"], "empty")
    series = "default"
    if metric == "spo2":
        srcs = {s.get("src") for s in samples_raw if isinstance(s, dict)}
        if "sleep_offset" in srcs or "sleep_epoch" in srcs:
            series = "sleep"
        elif "daily_offset" in srcs or "hourly" in srcs:
            series = "daytime"
    payload = {
        "metric": METRIC_ARCHIVE[metric],
        "series": series,
        "samples": samples,
        "coverage": snap.get("coverage"),
    }
    return _entry(class_id, snap["localDate"], "complete", payload)


def _map_sleep(routine):
    date = routine["date"]
    night = routine.get("night") or {}
    sleep = night.get("sleep")
    wake = night.get("wake")
    if not sleep or not wake:
        return _entry("sleep_night", date, "empty")
    payload = {
        "startedAt": _iso_utc(int(sleep)),
        "endedAt": _iso_utc(int(wake)),
    }
    if night.get("score") is not None:
        payload["sleepScore"] = night["score"]
    segs = night.get("levelSegments") or []
    if segs:
        payload["stageSegments"] = [
            {
                "startedAt": _iso_utc(int(s["start"])),
                "endedAt": _iso_utc(int(s["end"])),
                "stage": s.get("stage", "light"),
            }
            for s in segs
            if isinstance(s, dict) and s.get("start") and s.get("end")
        ]
    return _entry("sleep_night", date, "complete", payload)


def _map_naps(routine):
    date = routine["date"]
    naps = routine.get("naps") or []
    if not naps:
        return _entry("nap", date, "empty")
    mapped = []
    for n in naps:
        start = n.get("start")
        end = n.get("end")
        if start is None or end is None:
            continue
        mapped.append({
            "startedAt": _iso_utc(int(start)),
            "endedAt": _iso_utc(int(end)),
            "source": "garmin",
        })
    if not mapped:
        return _entry("nap", date, "empty")
    return _entry("nap", date, "complete", {"naps": mapped})


def _optional_number(val):
    if val is None:
        return None
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _type_key_from_summary(summary):
    if not isinstance(summary, dict):
        return None
    activity_type = summary.get("activityType") or summary.get("activityTypeDTO") or {}
    if isinstance(activity_type, dict):
        key = activity_type.get("typeKey") or activity_type.get("typeId")
        if key is not None and str(key).strip():
            return str(key)
    return None


def _garmin_time_to_iso(raw, field_is_gmt=False):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        ts = int(raw)
        if ts > 1_000_000_000_000:
            ts //= 1000
        return _iso_utc(ts)
    text = str(raw).strip()
    if not text:
        return None
    iso_text = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(iso_text)
        if dt.tzinfo is not None and dt.utcoffset() is not None:
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        pass
    # Garmin's documented-by-sample GMT fields omit the suffix but represent UTC.
    # Local fields without an offset are wall time only and cannot establish an instant.
    if field_is_gmt:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
                return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                continue
    return None


def _started_at_from_summary(summary):
    if not isinstance(summary, dict):
        return None
    for key in ("startTimeGMT", "beginTimestamp"):
        iso = _garmin_time_to_iso(summary.get(key), field_is_gmt=(key == "startTimeGMT"))
        if iso:
            return iso
    # Local wall time is only an instant when Garmin supplies an explicit UTC offset.
    return _garmin_time_to_iso(summary.get("startTimeLocal"))


def _ended_at_from_summary(summary):
    if not isinstance(summary, dict):
        return None
    for key in ("endTimeGMT", "endTimestamp"):
        ended_at = _garmin_time_to_iso(summary.get(key), field_is_gmt=(key == "endTimeGMT"))
        if ended_at:
            return ended_at
    # Do not attach UTC to an offset-free local clock value.
    return _garmin_time_to_iso(summary.get("endTimeLocal"))


def _asset_from_json(kind, obj):
    if obj is None:
        return {"kind": kind, "status": "failed", "sha256": ""}
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    return {
        "kind": kind,
        "status": "ready",
        "sha256": digest,
        "contentBase64": base64.b64encode(raw).decode("ascii"),
    }


def _asset_from_bytes(kind, data):
    if not data:
        return {"kind": kind, "status": "failed", "sha256": ""}
    digest = hashlib.sha256(data).hexdigest()
    return {
        "kind": kind,
        "status": "ready",
        "sha256": digest,
        "contentBase64": base64.b64encode(data).decode("ascii"),
    }


def _hash_activity_payload(payload):
    slim = {k: v for k, v in payload.items() if k != "assets"}
    slim["assets"] = [
        {k: v for k, v in asset.items() if k != "contentBase64"}
        for asset in payload.get("assets") or []
    ]
    return _hash_obj(slim)


def _activity_assets(ex, core_only=False):
    assets = []
    summary = ex.get("summary") or ex
    responses = ex.get("responses") or {}
    downloads = ex.get("downloads") or {}
    assets.append(_asset_from_json("summary", summary))
    if core_only:
        return assets
    assets.append(_asset_from_json("activity_full", responses.get("activity")))
    assets.append(_asset_from_json("details", responses.get("details")))
    for kind, key in (
        ("splits", "splits"),
        ("split_summaries", "splitSummaries"),
        ("typed_splits", "typedSplits"),
        ("heart_rate_zones", "heartRateInTimezones"),
        ("power_zones", "powerInTimezones"),
        ("exercise_sets", "exerciseSets"),
        ("weather", "weather"),
    ):
        assets.append(_asset_from_json(kind, responses.get(key)))
    original = downloads.get("original") or {}
    if original.get("status") == "ready" and original.get("bytes") is not None:
        assets.append(_asset_from_bytes("original_zip", original.get("bytes")))
    elif original.get("status") == "pending":
        assets.append({"kind": "original_zip", "status": "pending", "sha256": ""})
    else:
        assets.append({"kind": "original_zip", "status": "failed", "sha256": ""})
    return assets


def _map_activity(ex, core_only=False):
    date = ex.get("date")
    ext = ex.get("externalId")
    summary = ex.get("summary") or ex
    started_at = _started_at_from_summary(summary)
    if not started_at:
        metrics = ex.get("metrics") or {}
        start = metrics.get("startTime")
        if start is not None:
            started_at = _iso_utc(int(start))
    if not started_at:
        return _entry("activity", date or "", "failed", external_id=ext, error_code="missing_start")
    if not date:
        local_start = summary.get("startTimeLocal") if isinstance(summary, dict) else None
        if isinstance(local_start, str) and len(local_start) >= 10:
            date = local_start[:10]
        else:
            date = started_at[:10]
    ended_at = _ended_at_from_summary(summary)
    type_key = _type_key_from_summary(summary) or ex.get("sport")
    title = None
    if isinstance(summary, dict):
        title = summary.get("activityName") or summary.get("name")
    duration_seconds = _optional_number(summary.get("duration") if isinstance(summary, dict) else None)
    elapsed_duration_seconds = _optional_number(
        summary.get("elapsedDuration") if isinstance(summary, dict) else None
    )
    moving_duration_seconds = _optional_number(
        summary.get("movingDuration") if isinstance(summary, dict) else None
    )
    distance_meters = _optional_number(
        (summary.get("distance") if isinstance(summary, dict) else None)
        or (ex.get("metrics") or {}).get("distance")
    )
    elevation_gain_meters = _optional_number(
        summary.get("elevationGain") if isinstance(summary, dict) else None
    )
    avg_heart_rate_bpm = _optional_number(summary.get("averageHR") if isinstance(summary, dict) else None)
    avg_speed_mps = _optional_number(summary.get("averageSpeed") if isinstance(summary, dict) else None)
    avg_pace_seconds_per_km = _optional_number(
        summary.get("averagePace") or summary.get("avgPace") if isinstance(summary, dict) else None
    )
    avg_power_watts = _optional_number(summary.get("avgPower") or summary.get("averagePower") if isinstance(summary, dict) else None)
    calories = _optional_number(summary.get("calories") if isinstance(summary, dict) else None)
    payload = {
        "garminActivityId": str(ext),
        "startedAt": started_at,
        "typeKey": type_key,
        "assets": _activity_assets(ex, core_only=core_only),
    }
    if ended_at:
        payload["endedAt"] = ended_at
    if title:
        payload["title"] = str(title)
    if duration_seconds is not None:
        payload["durationSeconds"] = duration_seconds
    if elapsed_duration_seconds is not None:
        payload["elapsedDurationSeconds"] = elapsed_duration_seconds
    if moving_duration_seconds is not None:
        payload["movingDurationSeconds"] = moving_duration_seconds
    if distance_meters is not None:
        payload["distanceMeters"] = distance_meters
    if elevation_gain_meters is not None:
        payload["elevationGainMeters"] = elevation_gain_meters
    if avg_heart_rate_bpm is not None:
        payload["avgHeartRateBpm"] = avg_heart_rate_bpm
    if avg_speed_mps is not None:
        payload["avgSpeedMps"] = avg_speed_mps
    if avg_pace_seconds_per_km is not None:
        payload["avgPaceSecondsPerKm"] = avg_pace_seconds_per_km
    if avg_power_watts is not None:
        payload["avgPowerWatts"] = avg_power_watts
    if calories is not None:
        payload["calories"] = calories
    out = {
        "classId": "activity",
        "localDate": date,
        "completeness": "complete",
        "externalId": str(ext),
        "contentHash": _hash_activity_payload(payload),
        "parserVersion": PARSER_VERSION,
        "payload": payload,
    }
    return out


def _map_body_measurement(m):
    date = m["date"]
    payload = {}
    if m.get("weightKg") is not None:
        payload["weightKg"] = m["weightKg"]
    if not payload:
        return _entry("body_comp_on_day", date, "empty")
    if m.get("externalId"):
        payload["garminMeasurementId"] = str(m["externalId"])
    return _entry("body_comp_on_day", date, "complete", payload)


def build_normalized_batch(run_id, from_date, to_date, dailies, routines, exercises, series, measurements, core_only=False):
    entries = []
    for d in dailies:
        entries.append(_map_daily_summary(d))
    for r in routines:
        entries.append(_map_sleep(r))
        entries.append(_map_naps(r))
    for s in series:
        e = _map_series_entry(s)
        if e:
            entries.append(e)
    for ex in exercises:
        entries.append(_map_activity(ex, core_only=core_only))
    for m in measurements:
        entries.append(_map_body_measurement(m))
    return {
        "runId": run_id,
        "requestedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "localDateFrom": from_date,
        "localDateTo": to_date,
        "parserVersion": PARSER_VERSION,
        "entries": entries,
    }

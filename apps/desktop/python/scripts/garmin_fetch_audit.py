#!/usr/bin/env python3
"""Audit Garmin fetch coverage: one row per metric with API method, sample counts, and errors."""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from garmin_lib import (
    connect_with_token,
    emit,
    emit_fail,
    fetch_activities,
    fetch_day_series,
    map_body_measurement,
    map_daily,
    map_exercise,
    map_metric_snapshot,
    map_sleep,
    map_steps_cumulative,
    token_file_path,
)

CATALOG = [
    ("daily.steps", "map_daily", "get_stats", lambda c, d: map_daily(c, d).get("data", {}).get("steps")),
    ("daily.hydrationMl", "map_daily", "get_hydration_data", lambda c, d: map_daily(c, d).get("data", {}).get("hydrationMl")),
    ("daily.restingHr", "map_daily", "get_heart_rates", lambda c, d: map_daily(c, d).get("data", {}).get("restingHr")),
    ("daily.calories", "map_daily", "get_stats", lambda c, d: map_daily(c, d).get("data", {}).get("totalCalories")),
    ("daily.bodyBattery", "map_daily", "get_body_battery", lambda c, d: map_daily(c, d).get("data", {}).get("bodyBattery")),
    ("series.hr", "map_metric_snapshot", "get_heart_rates", lambda c, d: map_metric_snapshot(c, d, "hr")),
    ("series.hrv", "map_metric_snapshot", "get_hrv_data", lambda c, d: map_metric_snapshot(c, d, "hrv")),
    ("series.spo2", "map_metric_snapshot", "get_spo2_data", lambda c, d: map_metric_snapshot(c, d, "spo2")),
    ("series.respiration", "map_metric_snapshot", "get_respiration_data", lambda c, d: map_metric_snapshot(c, d, "respiration")),
    ("series.stress", "map_metric_snapshot", "get_stress_data", lambda c, d: map_metric_snapshot(c, d, "stress")),
    ("series.body_battery", "map_metric_snapshot", "get_body_battery", lambda c, d: map_metric_snapshot(c, d, "body_battery")),
    ("series.steps_cumulative", "map_steps_cumulative", "get_steps_data", lambda c, d: {"sampleCount": len(map_steps_cumulative(c, d)), "validCount": len(map_steps_cumulative(c, d))}),
    ("sleep.night", "map_sleep", "get_sleep_data", lambda c, d: map_sleep(c, d)),
    ("measurement.weight", "map_body_measurement", "get_body_composition", lambda c, d: map_body_measurement(c, d)),
    ("activities", "map_exercise", "connectapi activities", lambda c, d: _activity_probe(c, d)),
]


def _activity_probe(client, d: str):
    acts = fetch_activities(client, d, d)
    mapped = [map_exercise(a) for a in acts]
    mapped = [m for m in mapped if m]
    return {"count": len(mapped), "sample": mapped[0] if mapped else None}


def parse_args():
    p = argparse.ArgumentParser(description="Audit Garmin fetch coverage per metric")
    p.add_argument("--token-dir", required=True)
    p.add_argument("--date", dest="probe_date", default=None, help="YYYY-MM-DD, default today")
    return p.parse_args()


def probe_row(client, d: str, metric_id: str, fn_name: str, api_method: str, fetcher):
    row = {
        "metric": metric_id,
        "pythonFn": fn_name,
        "apiMethod": api_method,
        "date": d,
        "ok": False,
        "sampleCount": 0,
        "validCount": 0,
        "hasValue": False,
        "error": None,
        "note": None,
    }
    try:
        result = fetcher(client, d)
        if isinstance(result, dict) and "sampleCount" in result:
            row["sampleCount"] = result.get("sampleCount") or 0
            row["validCount"] = result.get("validCount") or 0
            row["hasValue"] = row["validCount"] > 0
        elif isinstance(result, dict) and "count" in result:
            row["sampleCount"] = result["count"]
            row["hasValue"] = result["count"] > 0
        elif result is not None:
            row["hasValue"] = True
            if isinstance(result, (int, float)):
                row["sampleCount"] = 1
            elif isinstance(result, dict):
                row["sampleCount"] = len(result)
        row["ok"] = True
    except Exception as e:
        row["error"] = str(e)
    return row


def main():
    args = parse_args()
    try:
        from garminconnect import Garmin  # noqa: F401
    except ImportError:
        emit_fail("deps_missing", "未安装 garminconnect")

    token_dir = str(Path(args.token_dir).expanduser().resolve())
    client, reason, message = connect_with_token(token_dir, token_file_path(token_dir))
    if not client:
        emit_fail(reason or "internal", message or "连接失败")

    d = args.probe_date or date.today().isoformat()
    rows = [probe_row(client, d, *spec) for spec in CATALOG]
    series_bundle = fetch_day_series(client, d)
    emit({
        "ok": True,
        "date": d,
        "metrics": rows,
        "seriesEmitted": [{"metric": s["metric"], "sampleCount": s["sampleCount"], "validCount": s["validCount"]} for s in series_bundle],
        "rustTables": {
            "daily": "daily_metrics",
            "series": "metric_day_snapshots",
            "sleep": "sleep_nights + naps",
            "activities": "activities",
            "measurements": "body_measurements",
            "meals": "meals (manual only)",
        },
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

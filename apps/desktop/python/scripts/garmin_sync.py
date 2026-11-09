#!/usr/bin/env python3
import argparse
import sys
import uuid
from datetime import date
from pathlib import Path

from garmin_lib import (
    call_with_timeout,
    connect_with_token,
    date_range,
    emit,
    emit_fail,
    fetch_activities,
    fetch_day_series,
    map_body_measurement,
    map_daily,
    map_sleep,
    progress,
    RouteTimeoutError,
    token_file_path,
)
from garmin_normalize import build_normalized_batch

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--from", dest="from_date", required=True)
    p.add_argument("--to", dest="to_date", required=True)
    p.add_argument("--token-dir", required=True)
    p.add_argument("--run-id", dest="run_id", default="")
    return p.parse_args()


def activity_id(activity):
    value = activity.get("activityId") or activity.get("activityIdDTO") or activity.get("id")
    return str(value) if value is not None else ""


def activity_summary_unit(summary, fallback_date):
    aid = activity_id(summary)
    start = summary.get("startTimeLocal") or summary.get("startTimeGMT") or ""
    return {
        "date": start[:10] if isinstance(start, str) and len(start) >= 10 else fallback_date,
        "externalId": aid,
        "summary": summary,
    }


def main():
    args = parse_args()
    try:
        from garminconnect import Garmin  # noqa: F401
    except ImportError:
        emit_fail("deps_missing", "未安装 garminconnect，请运行 apps/desktop/python/setup.ps1")

    token_dir = str(Path(args.token_dir).expanduser().resolve())
    token_file = token_file_path(token_dir)
    run_id = args.run_id.strip() or str(uuid.uuid4())

    client, reason, message = connect_with_token(token_dir, token_file)
    if not client:
        emit_fail(reason or "internal", message or "佳明同步失败")

    dailies = []
    routines = []
    exercises = []
    series = []
    measurements = []
    seen = set()
    try:
        progress("daily")
        for d in date_range(args.from_date, args.to_date):
            dailies.append(map_daily(client, d))
            series.extend(fetch_day_series(client, d))
            m = map_body_measurement(client, d)
            if m:
                measurements.append(m)
            sl = map_sleep(client, d)
            if sl:
                routines.append(sl)
        start_dt = date.fromisoformat(args.from_date)
        end_dt = date.fromisoformat(args.to_date)
        progress("activities")
        activities = call_with_timeout(
            lambda: fetch_activities(
                client,
                start_dt.isoformat(),
                end_dt.isoformat(),
            ),
            60,
            "拉取佳明活动列表超时",
        )
        if not isinstance(activities, list):
            activities = activities.get("activities", []) if isinstance(activities, dict) else []
        for act in activities:
            aid = activity_id(act)
            if not aid or aid in seen:
                continue
            seen.add(aid)
            # Deprecated whole-run adapter is deliberately core-only. Detail and Original
            # have separate bounded unit requests in garmin_unit.py.
            exercises.append(activity_summary_unit(act, args.from_date))
    except RouteTimeoutError as e:
        emit_fail("sync_timeout", str(e))
    except Exception as e:
        emit_fail("fetch_failed", f"拉取数据失败: {e}")

    batch = build_normalized_batch(
        run_id,
        args.from_date,
        args.to_date,
        dailies,
        routines,
        exercises,
        series,
        measurements,
        core_only=True,
    )
    emit({
        "ok": True,
        "from": args.from_date,
        "to": args.to_date,
        "batch": batch,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

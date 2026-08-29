#!/usr/bin/env python3
import argparse
import sys
from datetime import date
from pathlib import Path

from garmin_lib import (
    call_with_timeout,
    connect_with_token,
    date_range,
    emit,
    emit_fail,
    fetch_activities,
    in_sleep_window,
    map_daily,
    map_exercise,
    map_sleep,
    progress,
    RouteTimeoutError,
    token_file_path,
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--from", dest="from_date", required=True)
    p.add_argument("--to", dest="to_date", required=True)
    p.add_argument("--token-dir", required=True)
    return p.parse_args()


def main():
    args = parse_args()
    try:
        from garminconnect import Garmin  # noqa: F401
    except ImportError:
        emit_fail("deps_missing", "未安装 garminconnect，请运行 apps/desktop/python/setup.ps1")

    token_dir = str(Path(args.token_dir).expanduser().resolve())
    token_file = token_file_path(token_dir)

    client, reason, message = connect_with_token(token_dir, token_file)
    if not client:
        emit_fail(reason or "internal", message or "佳明同步失败")

    dailies = []
    routines = []
    exercises = []
    seen = set()
    try:
        progress("daily")
        for d in date_range(args.from_date, args.to_date):
            dailies.append(map_daily(client, d))
            if in_sleep_window(d, args.to_date):
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
            ex = map_exercise(act)
            if not ex:
                continue
            if ex["externalId"] in seen:
                continue
            seen.add(ex["externalId"])
            exercises.append(ex)
    except RouteTimeoutError as e:
        emit_fail("sync_timeout", str(e))
    except Exception as e:
        emit_fail("fetch_failed", f"拉取数据失败: {e}")

    emit({
        "ok": True,
        "from": args.from_date,
        "to": args.to_date,
        "daily": dailies,
        "routines": routines,
        "exercises": exercises,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Dump Garmin sleep API payload for inspection. Usage:
  python fetch_sleep.py [--date YYYY-MM-DD] [--token-dir PATH] [--days N]
"""
import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--date", default="", help="single date YYYY-MM-DD")
    p.add_argument("--days", type=int, default=3, help="look back N days ending today")
    p.add_argument("--token-dir", default="")
    return p.parse_args()


def token_dir_default():
    appdata = Path.home() / "AppData" / "Roaming" / "com.orbita.app" / "data" / "garmin"
    if appdata.is_dir():
        return appdata
    return Path.home() / ".garminconnect"


def login(token_dir: str):
    from garminconnect import Garmin

    td = Path(token_dir).resolve()
    tf = td / "garmin_tokens.json"
    if not tf.is_file() or tf.stat().st_size <= 2:
        print(json.dumps({"ok": False, "message": f"no token at {tf}"}, ensure_ascii=False))
        sys.exit(1)
    client = Garmin(retry_attempts=1, retry_max_wait=2.0, verify_login=False)
    client.login(str(td))
    return client


def pick_stages(dto: dict) -> dict:
    return {
        "deep": dto.get("deepSleepSeconds"),
        "light": dto.get("lightSleepSeconds"),
        "rem": dto.get("remSleepSeconds"),
        "awake": dto.get("awakeSleepSeconds"),
        "sleepTimeSeconds": dto.get("sleepTimeSeconds"),
        "napTimeSeconds": dto.get("napTimeSeconds"),
    }


def summarize_one(client, d: str) -> dict:
    raw = client.get_sleep_data(d)
    dto = raw.get("dailySleepDTO") or {}
    stages = pick_stages(dto)
    deep = stages["deep"] or 0
    light = stages["light"] or 0
    rem = stages["rem"] or 0
    awake = stages["awake"] or 0
    stage_sum = deep + light + rem
    sleep_start = dto.get("sleepStartTimestampGMT")
    sleep_end = dto.get("sleepEndTimestampGMT")
    window_sec = None
    if sleep_start and sleep_end:
        window_sec = (sleep_end - sleep_start) // 1000

    nap_keys = [k for k in dto if "nap" in k.lower()]
    root_nap_keys = [k for k in raw if "nap" in k.lower()]

    return {
        "date": d,
        "id": dto.get("id"),
        "calendarDate": dto.get("calendarDate"),
        "sleepWindowConfirmed": dto.get("sleepWindowConfirmed"),
        "sleepStartTimestampGMT": sleep_start,
        "sleepEndTimestampGMT": sleep_end,
        "sleepStartTimestampLocal": dto.get("sleepStartTimestampLocal"),
        "sleepEndTimestampLocal": dto.get("sleepEndTimestampLocal"),
        "stages_seconds": stages,
        "stage_sum_deep_light_rem": stage_sum,
        "window_seconds": window_sec,
        "stage_sum_plus_awake": stage_sum + awake,
        "remSleepData": raw.get("remSleepData"),
        "sleepLevels_count": len(raw.get("sleepLevels") or []),
        "dto_nap_keys": nap_keys,
        "root_nap_keys": root_nap_keys,
        "naps": raw.get("naps") or dto.get("naps") or dto.get("napDTOList"),
    }


def main():
    args = parse_args()
    token_dir = args.token_dir or str(token_dir_default())
    try:
        client = login(token_dir)
    except Exception as e:
        print(json.dumps({"ok": False, "message": str(e)}, ensure_ascii=False))
        return 1

    if args.date:
        dates = [args.date]
    else:
        end = date.today()
        dates = [(end - timedelta(days=i)).isoformat() for i in range(args.days)]
        dates.reverse()

    out = []
    for d in dates:
        try:
            out.append(summarize_one(client, d))
        except Exception as e:
            out.append({"date": d, "error": str(e)})

    print(json.dumps({"ok": True, "tokenDir": token_dir, "days": out}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

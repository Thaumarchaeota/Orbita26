#!/usr/bin/env python3
"""Read-only Garmin capability probe: today + yesterday. No writes, no SSO."""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

from garmin_lib import (
    connect_with_token,
    emit,
    emit_fail,
    map_daily,
    map_sleep,
    probe_series,
    token_file_path,
)


def parse_args():
    p = argparse.ArgumentParser()
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
        emit_fail(reason or "internal", message or "佳明探测失败")

    today = date.today()
    yesterday = today - timedelta(days=1)
    dates = [yesterday.isoformat(), today.isoformat()]

    capabilities = {
        "dates": dates,
        "daily": {},
        "sleep": {},
        "series": {},
        "weight": None,
        "bloodPressure": None,
    }

    for d in dates:
        try:
            daily = map_daily(client, d)
            capabilities["daily"][d] = {
                "fields": sorted((daily.get("data") or {}).keys()),
                "hasSteps": (daily.get("data") or {}).get("steps") is not None,
            }
        except Exception as e:
            capabilities["daily"][d] = {"error": str(e)}

        try:
            sl = map_sleep(client, d)
            capabilities["sleep"][d] = {"available": sl is not None}
        except Exception as e:
            capabilities["sleep"][d] = {"error": str(e)}

        try:
            capabilities["series"][d] = probe_series(client, d)
        except Exception as e:
            capabilities["series"][d] = {"error": str(e)}

    try:
        w = client.get_body_composition(today.isoformat())
        capabilities["weight"] = {"available": isinstance(w, dict) and bool(w)}
    except Exception:
        capabilities["weight"] = {"available": False}

    try:
        bp = client.get_blood_pressure(today.isoformat(), today.isoformat())
        capabilities["bloodPressure"] = {"available": isinstance(bp, (dict, list)) and bool(bp)}
    except Exception:
        capabilities["bloodPressure"] = {"available": False}

    emit({"ok": True, "capabilities": capabilities})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

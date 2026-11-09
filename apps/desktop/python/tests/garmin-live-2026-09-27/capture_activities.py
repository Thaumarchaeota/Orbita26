#!/usr/bin/env python3
"""Capture all Garmin activities in a date range using an existing token only."""

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from garmin_lib import connect_with_token, emit_fail, fetch_activities, sport_key, token_file_path  # noqa: E402


METHODS = {
    "activity": lambda c, i: c.get_activity(i),
    "details": lambda c, i: c.get_activity_details(i),
    "splits": lambda c, i: c.get_activity_splits(i),
    "splitSummaries": lambda c, i: c.get_activity_split_summaries(i),
    "typedSplits": lambda c, i: c.get_activity_typed_splits(i),
    "weather": lambda c, i: c.get_activity_weather(i),
    "heartRateInTimezones": lambda c, i: c.get_activity_hr_in_timezones(i),
    "powerInTimezones": lambda c, i: c.get_activity_power_in_timezones(i),
    "exerciseSets": lambda c, i: c.get_activity_exercise_sets(i),
    "gear": lambda c, i: c.get_activity_gear(i),
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--token-dir", required=True)
    p.add_argument("--from", dest="from_date", required=True)
    p.add_argument("--to", dest="to_date", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--downloads", action="store_true", help="download ORIGINAL, TCX, GPX, KML and CSV files")
    p.add_argument("--all-activities", action="store_true", help="capture every activity instead of one representative per type")
    p.add_argument("--only-type", default="", help="capture only the representative for this activityType.typeKey")
    p.add_argument("--pause", type=float, default=0.4)
    return p.parse_args()


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def activity_id(activity):
    value = activity.get("activityId") or activity.get("activityIdDTO") or activity.get("id")
    return str(value) if value is not None else ""


def walk_fields(value, path="$", out=None):
    out = out if out is not None else {}
    if isinstance(value, dict):
        for key, child in value.items():
            walk_fields(child, f"{path}.{key}", out)
    elif isinstance(value, list):
        key = f"{path}[]"
        row = out.setdefault(key, {"types": set(), "count": 0, "examples": []})
        row["types"].add("array")
        row["count"] += 1
        for child in value:
            walk_fields(child, key, out)
    else:
        row = out.setdefault(path, {"types": set(), "count": 0, "examples": []})
        row["types"].add(type(value).__name__)
        row["count"] += 1
        if len(row["examples"]) < 3 and value is not None:
            text = repr(value)
            if len(text) <= 300 and text not in row["examples"]:
                row["examples"].append(value)
    return out


def serializable_inventory(bundles):
    merged = {}
    for bundle in bundles:
        walk_fields(bundle, out=merged)
    return {
        key: {
            "types": sorted(row["types"]),
            "observations": row["count"],
            "examples": row["examples"],
        }
        for key, row in sorted(merged.items())
    }


def main():
    args = parse_args()
    out = Path(args.output_dir).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    raw_dir = out / "activities"
    raw_dir.mkdir(exist_ok=True)
    download_dir = out / "downloads"
    if args.downloads:
        download_dir.mkdir(exist_ok=True)

    token_dir = str(Path(args.token_dir).expanduser().resolve())
    client, reason, message = connect_with_token(token_dir, token_file_path(token_dir))
    if not client:
        emit_fail(reason or "internal", message or "Garmin token connection failed")

    index = fetch_activities(client, args.from_date, args.to_date)
    if not isinstance(index, list):
        index = index.get("activities", []) if isinstance(index, dict) else []
    seen = set()
    activities = []
    for item in index:
        if not isinstance(item, dict):
            continue
        aid = activity_id(item)
        if aid and aid not in seen:
            seen.add(aid)
            activities.append(item)

    all_activities = activities
    if not args.all_activities:
        representatives = {}
        for item in activities:
            key = sport_key(item) or "activity"
            representatives.setdefault(key, item)
        activities = list(representatives.values())
    if args.only_type:
        activities = [item for item in activities if (sport_key(item) or "activity") == args.only_type]

    write_json(out / "activity_index.json", {
        "capturedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localDateFrom": args.from_date,
        "localDateTo": args.to_date,
        "allActivityCount": len(all_activities),
        "representativeCount": len(activities),
        "activityTypes": sorted({sport_key(item) or "activity" for item in all_activities}),
        "activities": all_activities,
        "representatives": activities,
    })

    errors = []
    bundles = []
    formats = [("original", client.ActivityDownloadFormat.ORIGINAL, ".fit"),
               ("tcx", client.ActivityDownloadFormat.TCX, ".tcx"),
               ("gpx", client.ActivityDownloadFormat.GPX, ".gpx"),
               ("kml", client.ActivityDownloadFormat.KML, ".kml"),
               ("csv", client.ActivityDownloadFormat.CSV, ".csv")]
    for number, summary in enumerate(activities, 1):
        aid = activity_id(summary)
        bundle = {"activityId": aid, "summary": summary, "responses": {}, "downloads": {}}
        for name, method in METHODS.items():
            try:
                bundle["responses"][name] = method(client, aid)
            except Exception as exc:
                bundle["responses"][name] = None
                errors.append({"activityId": aid, "operation": name, "error": repr(exc)})
            time.sleep(max(0, args.pause))
        if args.downloads:
            for label, fmt, suffix in formats:
                try:
                    data = client.download_activity(aid, fmt)
                    target = download_dir / f"{aid}.{label}{suffix}"
                    target.write_bytes(data)
                    bundle["downloads"][label] = {"path": str(target.relative_to(out)), "bytes": len(data)}
                except Exception as exc:
                    bundle["downloads"][label] = None
                    errors.append({"activityId": aid, "operation": f"download:{label}", "error": repr(exc)})
                time.sleep(max(0, args.pause))
        write_json(raw_dir / f"{aid}.json", bundle)
        bundles.append(bundle)
        print(json.dumps({"progress": number, "total": len(activities), "activityId": aid}, ensure_ascii=False), file=sys.stderr, flush=True)

    write_json(out / "field_inventory.json", serializable_inventory(bundles))
    write_json(out / "errors.json", errors)
    write_json(out / "manifest.json", {
        "from": args.from_date,
        "to": args.to_date,
        "activityCount": len(activities),
        "allActivityCount": len(all_activities),
        "bundleCount": len(bundles),
        "errorCount": len(errors),
        "downloads": args.downloads,
        "apiOperations": list(METHODS),
    })
    print(json.dumps({"ok": True, "output": str(out), "activityCount": len(activities), "errorCount": len(errors)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""Offline counterexamples for source reuse; the coordinator runs this file."""
import copy
import importlib.util
import io
import json
import sys
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import garmin_lib as lib
import garmin_normalize as normalize

SPEC = importlib.util.spec_from_file_location("garmin_unit_fetch_dedup", HERE / "garmin_unit.py")
unit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(unit)

DAY = "2026-10-23"
T = 1792713600
CLASSES = {
    "hr": "health_day_sample_hr", "stress": "health_day_sample_stress",
    "body_battery": "health_day_sample_body_battery", "spo2": "health_day_sample_spo2",
    "respiration": "health_day_sample_respiration", "hrv": "health_day_sample_hrv",
    "steps_cumulative": "health_day_sample_steps",
}


def request(class_id=None, kind="fetch_daily_class"):
    target = {"localDate": DAY, "classId": class_id}
    if kind == "discover_activity_list":
        target = {"fromDate": "2026-10-17", "toDate": DAY}
    if kind == "fetch_activity_summary":
        target = {"localDate": DAY, "externalId": "42"}
    return {"protocolVersion": 1, "requestId": "r", "jobId": "j", "workItemId": "w",
            "unitKind": kind, "dataDirKey": "dir", "cancellationGeneration": 9, "target": target}


def source_activity(external_id=42, title="Run"):
    return {"activityId": external_id, "startTimeLocal": DAY + " 08:00:00",
            "startTimeGMT": DAY + "T00:00:00Z", "activityName": title,
            "duration": 1200, "distance": 1000, "activityType": {"typeKey": "running"}}


class SourceClient:
    garmin_connect_activities = "activities"

    def __init__(self):
        self.calls = Counter()

    def record(self, name, value):
        self.calls[name] += 1
        return copy.deepcopy(value)

    def get_heart_rates(self, _day):
        return self.record("hr", {"heartRateValues": [[T * 1000, 60], [(T + 60) * 1000, 65]]})

    def get_stress_data(self, _day):
        return self.record("stress", {"stressValuesArray": [[T * 1000, 20]],
                                      "bodyBatteryValuesArray": [[T * 1000, 0, 80]]})

    def get_body_battery(self, *_days):
        return self.record("bb_fallback", [])

    def get_spo2_data(self, _day):
        return self.record("spo2", {"spO2ValuesArray": [[T * 1000, 97]]})

    def get_respiration_data(self, _day):
        return self.record("respiration", {"respirationValuesArray": [[T * 1000, 13]]})

    def get_hrv_data(self, _day):
        return self.record("hrv", {"hrvReadings": [{"readingTimeGMT": DAY + "T00:00:00Z", "hrvValue": 43}]})

    def get_steps_data(self, _day):
        return self.record("steps", [{"startGMT": DAY + "T00:00:00Z", "steps": 10},
                                      {"startGMT": DAY + "T00:01:00Z", "steps": 20}])

    def get_sleep_data(self, _day):
        return self.record("sleep", {"dailySleepDTO": {"id": 1, "calendarDate": DAY,
            "deepSleepSeconds": 3600, "lightSleepSeconds": 7200,
            "sleepStartTimestampGMT": (T - 28800) * 1000, "sleepEndTimestampGMT": T * 1000},
            "naps": [{"napStartTimestampGMT": (T + 3600) * 1000,
                      "napEndTimestampGMT": (T + 4800) * 1000}]})

    def connectapi(self, _url, params=None):
        return self.record("activity_list", [source_activity()])


def fetch(req, client):
    with patch.object(unit, "connect_with_token", return_value=(client, None, None)):
        return unit.fetch_unit(req, ".")


class FetchDedupTest(unittest.TestCase):
    def test_real_metric_outputs_and_hashes_equal_old_day_helper_without_other_sources(self):
        old_entries = {entry["metric"]: normalize._map_series_entry(entry)
                       for entry in lib.fetch_day_series(SourceClient(), DAY)}
        expected_calls = {"hr": {"hr": 1}, "stress": {"stress": 1},
                          "body_battery": {"stress": 1}, "spo2": {"spo2": 1, "sleep": 1},
                          "respiration": {"respiration": 1}, "hrv": {"hrv": 1},
                          "steps_cumulative": {"steps": 1}}
        for metric, class_id in CLASSES.items():
            with self.subTest(metric=metric):
                client = SourceClient()
                result = fetch(request(class_id), client)
                self.assertEqual(result["outcome"], "complete")
                self.assertEqual(result["payload"], old_entries[metric])
                self.assertEqual(result["contentHash"], old_entries[metric]["contentHash"])
                self.assertEqual(client.calls, expected_calls[metric])

    def test_seven_day_samples_do_not_multiply_source_calls_by_seven_classes(self):
        client = SourceClient()
        for date in range(17, 24):
            for class_id in CLASSES.values():
                req = request(class_id)
                req["target"]["localDate"] = "2026-10-" + str(date)
                fetch(req, client)
        self.assertEqual(client.calls, {"hr": 7, "stress": 14, "spo2": 7, "sleep": 7,
                                       "respiration": 7, "hrv": 7, "steps": 7})

    def test_sleep_and_nap_share_one_source_and_keep_original_hashes(self):
        for primary, sibling, mapper in (("sleep_night", "nap", normalize._map_sleep),
                                         ("nap", "sleep_night", normalize._map_naps)):
            with self.subTest(primary=primary):
                client = SourceClient()
                result = fetch(request(primary), client)
                routine = lib.map_sleep(SourceClient(), DAY)
                self.assertEqual(result["payload"], mapper(routine))
                self.assertEqual(client.calls, {"sleep": 1})
                related = result.get("relatedEntries", [])
                self.assertEqual([entry["classId"] for entry in related], [sibling])
                sibling_mapper = normalize._map_naps if sibling == "nap" else normalize._map_sleep
                self.assertEqual(related[0], sibling_mapper(routine))

    def test_related_mapping_failure_does_not_poison_primary(self):
        for primary, broken in (("sleep_night", "_map_naps"), ("nap", "_map_sleep")):
            with self.subTest(primary=primary), patch.object(unit, broken, side_effect=ValueError("bad sibling")):
                result = fetch(request(primary), SourceClient())
                self.assertEqual(result["outcome"], "complete")
                self.assertEqual(result["payload"]["classId"], primary)
                self.assertFalse(result.get("relatedEntries"))

    def test_companion_is_omitted_before_it_can_overflow_an_otherwise_valid_sleep_frame(self):
        primary = {"classId": "sleep_night", "localDate": DAY, "completeness": "complete",
                   "parserVersion": 2, "contentHash": "primary-hash",
                   "payload": {"padding": "x" * (unit.MAX_CONTROL_FRAME - 50000)}}
        companion = {"classId": "nap", "localDate": DAY, "completeness": "complete",
                     "parserVersion": 2, "contentHash": "companion-hash", "payload": {"padding": "y" * 100000}}
        with patch.object(unit, "_map_sleep", return_value=primary), \
             patch.object(unit, "_map_naps", return_value=companion):
            result = fetch(request("sleep_night"), SourceClient())
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["payload"], primary)
        output = io.BytesIO()
        unit.write_frame(output, result)
        self.assertFalse(result.get("relatedEntries"))

    def test_nap_only_resume_without_any_cache_fetches_source(self):
        client = SourceClient()
        self.assertEqual(fetch(request("nap"), client)["outcome"], "complete")
        self.assertEqual(client.calls, {"sleep": 1})

    def test_summary_only_resume_without_discovery_cache_fetches_list(self):
        client = SourceClient()
        result = fetch(request(kind="fetch_activity_summary"), client)
        self.assertEqual(client.calls, {"activity_list": 1})
        self.assertEqual(result["payload"], normalize._map_activity(
            {"date": DAY, "externalId": "42", "summary": source_activity()}, core_only=True))

    def test_discovery_snapshot_is_original_core_summary(self):
        client = SourceClient()
        result = fetch(request(kind="discover_activity_list"), client)
        rows = result["payload"]["activities"]
        self.assertEqual(client.calls, {"activity_list": 1})
        self.assertEqual(rows[0]["normalizedEntry"], normalize._map_activity(
            {"date": DAY, "externalId": "42", "summary": source_activity()}, core_only=True))

    def test_optional_snapshot_oversize_keeps_all_discovery_identities_and_valid_frame(self):
        class LargeClient(SourceClient):
            def connectapi(self, _url, params=None):
                self.calls["activity_list"] += 1
                return [source_activity(i, "睡" * 90000) for i in range(1, 4)]
        result = fetch(request(kind="discover_activity_list"), LargeClient())
        rows = result["payload"]["activities"]
        self.assertEqual({row["externalId"] for row in rows}, {"1", "2", "3"})
        self.assertEqual(result["outcome"], "complete")
        stream = io.BytesIO()
        unit.write_frame(stream, result)
        self.assertLessEqual(len(stream.getvalue()) - 36, unit.MAX_CONTROL_FRAME)
        self.assertFalse(any(row.get("normalizedEntry") for row in rows))

    def test_aggregate_optional_budget_uses_utf8_bytes_and_never_truncates_identity_list(self):
        class ManyClient(SourceClient):
            def connectapi(self, _url, params=None):
                return [source_activity(i, "睡" * 20000) for i in range(1, 20)]
        result = fetch(request(kind="discover_activity_list"), ManyClient())
        rows = result["payload"]["activities"]
        self.assertEqual({row["externalId"] for row in rows}, {str(i) for i in range(1, 20)})
        snapshots = [row["normalizedEntry"] for row in rows if "normalizedEntry" in row]
        self.assertLess(len(snapshots), 19)
        encoded_bytes = sum(len(json.dumps(entry, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
                            for entry in snapshots)
        self.assertLessEqual(encoded_bytes, 512 * 1024)
        unit.write_frame(io.BytesIO(), result)

    def test_duplicate_or_incomplete_discovery_never_supplies_reusable_summary(self):
        for rows, evidence in (([source_activity(), source_activity()], {"complete": False}),
                               ([source_activity()], {"complete": False})):
            with self.subTest(rows=len(rows)), \
                 patch.object(unit, "fetch_activities_with_evidence", return_value=(rows, dict(evidence))):
                result = fetch(request(kind="discover_activity_list"), SourceClient())
            self.assertEqual(result["outcome"], "incomplete")
            self.assertFalse(any(row.get("normalizedEntry") for row in result["payload"]["activities"]))

    def test_incomplete_discovery_and_mapping_failure_keep_original_id_list(self):
        rows = [source_activity(), source_activity(43)]
        for evidence in ({"complete": False}, {"complete": True}):
            with self.subTest(evidence=evidence), \
                 patch.object(unit, "fetch_activities_with_evidence", return_value=(rows, dict(evidence))), \
                 patch.object(unit, "_map_activity", side_effect=ValueError("bad source")):
                result = fetch(request(kind="discover_activity_list"), SourceClient())
                self.assertEqual({r["externalId"] for r in result["payload"]["activities"]}, {"42", "43"})
                self.assertEqual(result["outcome"], "complete" if evidence["complete"] else "incomplete")

    def test_rate_limit_survives_real_helpers_swallowing_exception_and_stops_fallback(self):
        class TooManyRequests(Exception):
            status_code = 429
        for class_id, failing in (("sleep_night", "get_sleep_data"),
                                  ("health_day_sample_body_battery", "get_stress_data"),
                                  ("health_day_sample_spo2", "get_spo2_data")):
            client = SourceClient()
            req = request(class_id)
            input_buffer = io.BytesIO()
            unit.write_frame(input_buffer, req)
            input_buffer.seek(0)
            output_buffer = io.BytesIO()
            stdin = type("Input", (), {"buffer": input_buffer})()
            stdout = type("Output", (), {"buffer": output_buffer})()
            with self.subTest(class_id=class_id), \
                 patch.object(client, failing, side_effect=TooManyRequests()), \
                 patch.object(unit, "connect_with_token", return_value=(client, None, None)), \
                 patch.object(unit.sys, "stdin", stdin), patch.object(unit.sys, "stdout", stdout), \
                 patch.object(unit.sys, "argv", ["garmin_unit.py", "--token-dir", "."]):
                unit.main()
            encoded = output_buffer.getvalue()
            response = json.loads(encoded[36:])
            self.assertEqual(response["outcome"], "rate_limited")
            self.assertIsNone(response["payload"])
            self.assertFalse(response.get("relatedEntries"))
            self.assertEqual(client.calls, {})

    def test_connect_rate_limit_reason_is_not_downgraded_to_terminal_failure(self):
        with patch.object(unit, "connect_with_token", return_value=(None, "rate_limited", "private")):
            result = unit.fetch_unit(request("sleep_night"), ".")
        self.assertEqual(result["outcome"], "rate_limited")
        self.assertNotIn("private", json.dumps(result))


if __name__ == "__main__":
    unittest.main()

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

PYTHON_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = PYTHON_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(PYTHON_ROOT))


class GarminNormalizeTests(unittest.TestCase):
    def setUp(self):
        from garmin_lib import (
            map_daily,
            map_exercise,
            map_naps,
            map_sleep,
            parse_ts_seconds,
            safe_int,
        )

        self.map_sleep = map_sleep
        self.map_naps = map_naps
        self.map_daily = map_daily
        self.map_exercise = map_exercise
        self.parse_ts_seconds = parse_ts_seconds
        self.safe_int = safe_int

    @staticmethod
    def garmin_content_hash(samples, fetched_at=None):
        canonical = json.dumps(samples, sort_keys=True, separators=(",", ":"))
        return hash(canonical)

    def test_parse_ts_seconds_millis_and_seconds(self):
        self.assertEqual(self.parse_ts_seconds(1738368000000), 1738368000)
        self.assertEqual(self.parse_ts_seconds(1738368000), 1738368000)
        self.assertEqual(self.parse_ts_seconds("1738368000000"), 1738368000)

    def test_map_sleep_uses_wake_date_calendar_date(self):
        client = mock.MagicMock()
        start_ms = 1738339200000
        end_ms = 1738368000000
        client.get_sleep_data.return_value = {
            "dailySleepDTO": {
                "id": 1,
                "sleepStartTimestampGMT": start_ms,
                "sleepEndTimestampGMT": end_ms,
                "calendarDate": "2026-01-02",
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 7200,
                "remSleepSeconds": 1800,
                "awakeSleepSeconds": 300,
            }
        }
        out = self.map_sleep(client, "2026-01-01")
        self.assertIsNotNone(out)
        self.assertEqual(out["date"], "2026-01-02")
        self.assertEqual(out["night"]["sleep"], start_ms // 1000)
        self.assertEqual(out["night"]["wake"], end_ms // 1000)
        self.assertEqual(out["night"]["source"], "garmin")

    def test_map_sleep_returns_none_without_valid_stages(self):
        client = mock.MagicMock()
        client.get_sleep_data.return_value = {
            "dailySleepDTO": {
                "id": 1,
                "sleepStartTimestampGMT": 1738339200000,
                "sleepEndTimestampGMT": 1738368000000,
                "deepSleepSeconds": 0,
                "lightSleepSeconds": 0,
                "remSleepSeconds": 0,
            }
        }
        self.assertIsNone(self.map_sleep(client, "2026-01-01"))

    def test_map_naps_from_garmin_dto(self):
        raw = {
            "naps": [
                {
                    "napStartTimestampGMT": 1738350000000,
                    "napEndTimestampGMT": 1738353600000,
                    "source": "garmin",
                }
            ]
        }
        dto = {"napTimeSeconds": 3600}
        naps = self.map_naps(raw, dto)
        self.assertEqual(len(naps), 1)
        self.assertEqual(naps[0]["source"], "garmin")
        self.assertEqual(naps[0]["start"], 1738350000)
        self.assertEqual(naps[0]["end"], 1738353600)

    def test_map_daily_includes_hydration_and_steps(self):
        client = mock.MagicMock()
        client.get_stats.return_value = {
            "totalSteps": 8500,
            "activeKilocalories": 400,
            "totalKilocalories": 2200,
        }
        client.get_heart_rates.return_value = {"restingHeartRate": 58}
        client.get_hydration_data.return_value = {"valueInML": 1800}
        client.get_intensity_minutes_data.return_value = {}
        client.get_body_battery.return_value = []
        out = self.map_daily(client, "2026-03-15")
        self.assertEqual(out["date"], "2026-03-15")
        self.assertEqual(out["data"]["steps"], 8500)
        self.assertEqual(out["data"]["hydrationMl"], 1800)
        self.assertEqual(out["data"]["restingHr"], 58)
        self.assertIn("fetchedAt", out)

    def test_map_exercise_cycling_only_with_external_id(self):
        act = {
            "activityId": 12345,
            "activityType": {"typeKey": "cycling"},
            "duration": 3600,
            "distance": 25000,
            "startTimeLocal": "2026-03-15T08:30:00",
        }
        out = self.map_exercise(act)
        self.assertIsNotNone(out)
        self.assertEqual(out["externalId"], "12345")
        self.assertEqual(out["sport"], "cycling")
        self.assertEqual(out["date"], "2026-03-15")

    def test_map_exercise_accepts_running_with_start_time(self):
        act = {
            "activityId": 99,
            "activityType": {"typeKey": "running"},
            "duration": 1800,
            "startTimeGMT": "2026-03-15T00:30:00.0",
            "startTimeLocal": "2026-03-15T08:30:00",
        }
        out = self.map_exercise(act)
        self.assertIsNotNone(out)
        self.assertEqual(out["sport"], "running")

    def test_map_metric_snapshot_stress_values_array(self):
        from garmin_lib import map_metric_snapshot

        client = mock.MagicMock()
        client.get_stress_data.return_value = {
            "stressValuesArray": [[1735689600000, 35], [1735693200000, 42]],
        }
        snap = map_metric_snapshot(client, "2026-01-01", "stress")
        self.assertEqual(snap["sampleCount"], 2)
        self.assertEqual(snap["validCount"], 2)

    def test_map_metric_snapshot_body_battery_from_stress(self):
        from garmin_lib import map_metric_snapshot

        client = mock.MagicMock()
        client.get_stress_data.return_value = {
            "bodyBatteryValuesArray": [[1735689600000, 0, 55], [1735693200000, 0, 48]],
        }
        client.get_body_battery.return_value = []
        snap = map_metric_snapshot(client, "2026-01-01", "body_battery")
        self.assertEqual(snap["sampleCount"], 2)
        self.assertEqual(snap["samples"][0]["v"], 55)

    def test_map_daily_spo2_time_offset_values(self):
        from garmin_lib import map_daily_spo2_samples

        client = mock.MagicMock()
        client.get_spo2_data.return_value = {
            "StartTimeInSeconds": 1735689600,
            "TimeOffsetSpo2Values": {
                "3600": 98,
                "43200": 97,
                "-1": 0,
            },
        }
        samples = map_daily_spo2_samples(client, "2025-01-01")
        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0]["v"], 98)
        self.assertEqual(samples[1]["v"], 97)
        self.assertEqual(samples[0]["src"], "daily_offset")

    def test_map_daily_spo2_hourly_averages(self):
        from garmin_lib import map_daily_spo2_samples

        client = mock.MagicMock()
        client.get_spo2_data.return_value = {
            "calendarDate": "2026-08-30",
            "averageSpO2": 95,
            "spO2HourlyAverages": [[1788019200000, 95], [1788022800000, 93]],
        }
        samples = map_daily_spo2_samples(client, "2026-08-30")
        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0]["v"], 95)
        self.assertEqual(samples[1]["v"], 93)
        self.assertEqual(samples[0]["src"], "hourly")

    def test_map_sleep_spo2_time_offset_map(self):
        from garmin_lib import map_sleep_spo2_samples

        client = mock.MagicMock()
        client.get_sleep_data.return_value = {
            "dailySleepDTO": {
                "sleepStartTimestampGMT": 1735689600000,
                "timeOffsetSleepSpo2": {"0": 95, "300": 93, "600": 96},
            },
        }
        samples = map_sleep_spo2_samples(client, "2025-01-01")
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[0]["v"], 95)
        self.assertEqual(samples[1]["t"], 1735689600 + 300)
        self.assertEqual(samples[0]["src"], "sleep_offset")

    def test_map_spo2_merges_daily_and_sleep(self):
        from garmin_lib import map_spo2_samples

        client = mock.MagicMock()
        client.get_spo2_data.return_value = {
            "StartTimeInSeconds": 1735689600,
            "TimeOffsetSpo2Values": {"7200": 96},
        }
        client.get_sleep_data.return_value = {
            "wellnessEpochSPO2DataDTOList": [
                {"epochTimestamp": 1735718400000, "spo2Reading": 95},
            ],
        }
        samples = map_spo2_samples(client, "2025-01-01")
        self.assertEqual(len(samples), 2)
        ts = {s["t"] for s in samples}
        self.assertIn(1735689600 + 7200, ts)
        self.assertIn(1735718400, ts)
        samples = [{"t": 100, "v": 72}, {"t": 200, "v": 74}]
        h1 = self.garmin_content_hash(samples)
        h2 = self.garmin_content_hash(samples)
        self.assertEqual(h1, h2)

    def test_content_hash_ignores_fetched_at(self):
        samples = [{"t": 1, "v": 60}]
        h1 = self.garmin_content_hash(samples)
        h2 = self.garmin_content_hash(samples, fetched_at=1000)
        h3 = self.garmin_content_hash(samples, fetched_at=9999)
        self.assertEqual(h1, h2)
        self.assertEqual(h2, h3)
        self.assertNotIn("fetched_at", json.dumps(samples))


class GarminNormalizeIsolationTests(unittest.TestCase):
    def test_map_sleep_does_not_read_journal_json(self):
        root = Path(tempfile.mkdtemp(prefix="orbita-garmin-norm-"))
        journal_dir = root / "journal"
        journal_dir.mkdir()
        journal_file = journal_dir / "2026.json"
        journal_file.write_text(
            json.dumps({"entries": [{"id": "old", "kind": "daily", "date": "2026-01-01"}]}),
            encoding="utf-8",
        )

        from garmin_lib import map_sleep

        client = mock.MagicMock()
        client.get_sleep_data.return_value = {
            "dailySleepDTO": {
                "id": 1,
                "sleepStartTimestampGMT": 1738339200000,
                "sleepEndTimestampGMT": 1738368000000,
                "calendarDate": "2026-01-02",
                "deepSleepSeconds": 3600,
                "lightSleepSeconds": 3600,
                "remSleepSeconds": 1800,
            }
        }
        out = map_sleep(client, "2026-01-01")
        self.assertEqual(out["date"], "2026-01-02")
        self.assertTrue(journal_file.exists())
        stored = json.loads(journal_file.read_text(encoding="utf-8"))
        self.assertEqual(stored["entries"][0]["id"], "old")

        shutil.rmtree(root, ignore_errors=True)

    def test_garmin_sync_fetches_sleep_for_full_date_range(self):
        import garmin_sync as mod

        sleep_days = []

        def fake_map_sleep(_client, d):
            sleep_days.append(d)
            return None

        client = mock.MagicMock()
        with (
            mock.patch.dict("sys.modules", {"garminconnect": mock.MagicMock()}),
            mock.patch.object(mod, "connect_with_token", return_value=(client, None, None)),
            mock.patch.object(mod, "map_daily", return_value={}),
            mock.patch.object(mod, "fetch_day_series", return_value=[]),
            mock.patch.object(mod, "map_body_measurement", return_value=None),
            mock.patch.object(mod, "map_sleep", side_effect=fake_map_sleep),
            mock.patch.object(mod, "fetch_activities", return_value=[]),
            mock.patch.object(mod, "emit"),
            mock.patch(
                "sys.argv",
                ["garmin_sync.py", "--from", "2026-08-01", "--to", "2026-08-21", "--token-dir", "/tmp"],
            ),
        ):
            mod.main()

        self.assertEqual(len(sleep_days), 21)
        self.assertEqual(sleep_days[0], "2026-08-01")
        self.assertEqual(sleep_days[-1], "2026-08-21")


if __name__ == "__main__":
    unittest.main()

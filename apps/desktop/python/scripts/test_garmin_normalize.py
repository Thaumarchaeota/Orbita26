import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "garmin_normalize", SCRIPT_DIR / "garmin_normalize.py"
)
gn = importlib.util.module_from_spec(SPEC)
sys.modules["garmin_normalize"] = gn
SPEC.loader.exec_module(gn)


class GarminNormalizeCompletenessTest(unittest.TestCase):
    def test_daily_summary_empty_when_no_fields(self):
        entry = gn._map_daily_summary({"date": "2026-01-10", "data": {}})
        self.assertEqual(entry["completeness"], "empty")
        self.assertNotIn("contentHash", entry)

    def test_daily_summary_empty_when_data_missing(self):
        entry = gn._map_daily_summary({"date": "2026-01-10"})
        self.assertEqual(entry["completeness"], "empty")

    def test_series_empty_when_no_samples(self):
        entry = gn._map_series_entry(
            {"metric": "hrv", "localDate": "2026-01-10", "samples": []}
        )
        self.assertEqual(entry["completeness"], "empty")
        self.assertEqual(entry["classId"], "health_day_sample_hrv")

    def test_activity_failed_when_start_missing(self):
        entry = gn._map_activity(
            {
                "date": "2026-01-10",
                "externalId": "fixture-activity-1",
                "sport": "running",
                "duration": 1800,
                "metrics": {},
            }
        )
        self.assertEqual(entry["completeness"], "failed")
        self.assertEqual(entry["errorCode"], "missing_start")
        self.assertNotIn("payload", entry)

    def test_nap_empty_when_list_missing(self):
        entry = gn._map_naps({"date": "2026-01-10"})
        self.assertEqual(entry["completeness"], "empty")

    def test_body_comp_empty_when_no_weight(self):
        entry = gn._map_body_measurement({"date": "2026-01-10"})
        self.assertEqual(entry["completeness"], "empty")


class GarminActivityTimeTest(unittest.TestCase):
    def test_local_wall_time_without_offset_is_not_treated_as_utc(self):
        summary = {"startTimeLocal": "2026-01-10T09:30:00"}
        self.assertIsNone(gn._started_at_from_summary(summary))
        self.assertIsNone(gn._ended_at_from_summary({"endTimeLocal": "2026-01-10 10:30:00"}))

        entry = gn._map_activity(
            {
                "date": "2026-01-10",
                "externalId": "fixture-local-only",
                "summary": summary,
            }
        )
        self.assertEqual(entry["completeness"], "failed")
        self.assertEqual(entry["errorCode"], "missing_start")

    def test_gmt_wins_when_local_wall_time_is_also_present(self):
        started = gn._started_at_from_summary(
            {
                "startTimeGMT": "2026-01-10T01:30:00Z",
                "startTimeLocal": "2026-01-10T09:30:00",
            }
        )
        self.assertEqual(started, "2026-01-10T01:30:00Z")

    def test_epoch_milliseconds_are_converted_to_utc(self):
        self.assertEqual(
            gn._started_at_from_summary({"startTimeGMT": 1768008600000}),
            "2026-01-10T01:30:00Z",
        )

    def test_explicit_offset_is_converted_to_utc(self):
        self.assertEqual(
            gn._started_at_from_summary(
                {"beginTimestamp": "2026-01-10T09:30:00+08:00"}
            ),
            "2026-01-10T01:30:00Z",
        )
        self.assertEqual(
            gn._started_at_from_summary(
                {"startTimeLocal": "2026-01-10T09:30:00+08:00"}
            ),
            "2026-01-10T01:30:00Z",
            "a local value with an explicit offset identifies a UTC instant",
        )


if __name__ == "__main__":
    unittest.main()

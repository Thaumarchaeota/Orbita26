"""Regression coverage for conservative Garmin daily-unit recovery."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("garmin_unit_recovery", HERE / "garmin_unit.py")
unit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(unit)


def request(class_id):
    return {
        "protocolVersion": 1,
        "requestId": "request-1",
        "jobId": "job-1",
        "workItemId": "item-1",
        "unitKind": "fetch_daily_class",
        "dataDirKey": "synthetic-data-dir",
        "cancellationGeneration": 0,
        "target": {"localDate": "2026-10-23", "classId": class_id},
    }


class FakeClient:
    """Only implements the daily methods exercised by map_daily; no network access."""

    def get_stats(self, _day):
        return {"totalSteps": 1234, "activeKilocalories": 321, "totalKilocalories": 2100}

    def get_intensity_minutes_data(self, _day):
        return {}

    def get_heart_rates(self, _day):
        return {"restingHeartRate": 52}

    def get_hydration_data(self, _day):
        return {"valueInML": 750}

    def get_body_battery(self, _start, _end):
        return []

    def get_stress_data(self, _day):
        return {}

    def get_spo2_data(self, _day):
        return {}

    def get_hrv_data(self, _day):
        return {}


class GarminUnitRecoveryTest(unittest.TestCase):
    def test_daily_summary_maps_real_map_daily_shape_once(self):
        with patch.object(unit, "connect_with_token", return_value=(FakeClient(), None, None)), \
             patch.object(unit, "map_daily", wraps=unit.map_daily) as map_daily:
            result = unit.fetch_unit(request("health_day_summary"), ".")

        map_daily.assert_called_once()
        self.assertEqual(result["outcome"], "complete")
        payload = result["payload"]
        self.assertEqual(payload["classId"], "health_day_summary")
        self.assertEqual(payload["localDate"], "2026-10-23")
        self.assertEqual(payload["payload"], {
            "restingHeartRateBpm": 52,
            "totalSteps": 1234,
            "totalCaloriesKcal": 2100,
            "activeCaloriesKcal": 321,
            "hydrationMl": 750,
        })

    def test_missing_sleep_and_nap_are_empty_unverified_not_exceptions(self):
        class SleepClient:
            def get_sleep_data(self, _day):
                return None

        for class_id in ("sleep_night", "nap"):
            with self.subTest(class_id=class_id), \
                 patch.object(unit, "connect_with_token", return_value=(SleepClient(), None, None)):
                result = unit.fetch_unit(request(class_id), ".")
            self.assertEqual(result["outcome"], "empty_unverified")
            self.assertEqual(result["payload"]["classId"], class_id)
            self.assertEqual(result["payload"]["localDate"], "2026-10-23")
            self.assertEqual(result["payload"]["completeness"], "empty")
            self.assertNotIn("errorCode", result)


if __name__ == "__main__":
    unittest.main()

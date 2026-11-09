import hashlib
import importlib.util
import json
import struct
import unittest
from unittest.mock import patch
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("garmin_unit", HERE / "garmin_unit.py")
unit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(unit)
NORMALIZER_SPEC = importlib.util.spec_from_file_location("garmin_normalize", HERE / "garmin_normalize.py")
normalize = importlib.util.module_from_spec(NORMALIZER_SPEC)
NORMALIZER_SPEC.loader.exec_module(normalize)


def frame(value):
    body = json.dumps(value, separators=(",", ":")).encode()
    return struct.pack(">I", len(body)) + hashlib.sha256(body).digest() + body


def request(kind="fetch_daily_class"):
    return {"protocolVersion": 1, "requestId": "req-1", "jobId": "job-1",
            "workItemId": "item-1", "unitKind": kind, "dataDirKey": "dir-key",
            "cancellationGeneration": 4, "target": {"localDate": "2026-10-13"}}


class GarminUnitProtocolTest(unittest.TestCase):
    def test_activity_summary_unit_fetches_only_requested_external_activity(self):
        class Client: pass
        req = request("fetch_activity_summary")
        req["target"] = {"localDate": "2026-10-13", "externalId": "act-7"}
        source = {"activityId": 7, "startTimeLocal": "2026-10-13 09:00:00", "startTimeGMT": "2026-10-13T01:00:00Z",
                  "activityName": "Run", "duration": 1200, "activityType": {"typeKey": "running"}}
        with patch.object(unit, "connect_with_token", return_value=(Client(), None, None)), \
             patch.object(unit, "fetch_activities_with_evidence", return_value=([source], {"complete": True})) as fetch:
            result = unit.fetch_unit(req, ".")
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.args[1:], ("2026-10-13", "2026-10-13"))
        self.assertEqual(result["outcome"], "complete")
        self.assertEqual(result["payload"]["externalId"], "7")
        self.assertEqual(result["payload"]["classId"], "activity")
        self.assertEqual([a["kind"] for a in result["payload"]["payload"]["assets"]], ["summary"])

    def test_activity_list_pagination_requires_observed_terminal_page_and_unique_ids(self):
        class Client:
            garmin_connect_activities = "activities"
            def __init__(self, pages): self.pages, self.calls = pages, []
            def connectapi(self, url, params):
                self.calls.append(params["start"])
                return self.pages[len(self.calls) - 1]
        full = [{"activityId": str(i)} for i in range(20)]
        client = Client([full, [{"activityId": "last"}]])
        rows, evidence = __import__("garmin_lib").fetch_activities_with_evidence(client, "2026-10-08", "2026-10-14", max_pages=2)
        self.assertTrue(evidence["complete"])
        self.assertEqual(client.calls, ["0", "20"])
        capped = Client([full])
        _, evidence = __import__("garmin_lib").fetch_activities_with_evidence(capped, "2026-10-08", "2026-10-14", max_pages=1)
        self.assertFalse(evidence["complete"])
        duplicate = Client([[{"activityId": "x"}, {"activityId": "x"}]])
        _, evidence = __import__("garmin_lib").fetch_activities_with_evidence(duplicate, "2026-10-08", "2026-10-14")
        self.assertFalse(evidence["complete"])

    def test_rejects_oversized_frame_before_reading_body(self):
        data = struct.pack(">I", unit.MAX_CONTROL_FRAME + 1) + bytes(32)
        with self.assertRaisesRegex(ValueError, "exceeds limit"):
            unit.read_frame(__import__("io").BytesIO(data))

    def test_rejects_trailing_duplicate_frame(self):
        encoded = frame(request())
        with self.assertRaisesRegex(ValueError, "trailing"):
            unit.read_frame(__import__("io").BytesIO(encoded + encoded))

    def test_supports_each_typed_unit(self):
        for kind in unit.UNIT_KINDS:
            self.assertEqual(unit.read_frame(__import__("io").BytesIO(frame(request(kind))))["unitKind"], kind)

    def test_original_response_contract_has_no_asset_bytes_field(self):
        response = unit.response_for(request("fetch_activity_original"), "complete",
                                     contentHash="a" * 64, assetLength=12,
                                     assetMetadata={"mediaType": "application/zip"})
        encoded = json.dumps(response)
        self.assertNotIn("contentBase64", encoded)
        self.assertNotIn("bytes", response)

    def test_deprecated_daily_script_never_fetches_detail_or_original(self):
        source = (HERE / "garmin_sync.py").read_text(encoding="utf-8")
        self.assertNotIn("get_activity_details", source)
        self.assertNotIn("download_activity", source)
        self.assertNotIn("get_activity_splits", source)

    def test_daily_core_normalization_does_not_create_detail_or_original_assets(self):
        batch = normalize.build_normalized_batch(
            "run", "2026-10-13", "2026-10-13", [], [],
            [{"date": "2026-10-13", "externalId": "a-1",
              "summary": {"startTimeGMT": "2026-10-13T01:00:00Z"}}], [], [], core_only=True)
        assets = batch["entries"][0]["payload"]["assets"]
        self.assertEqual([asset["kind"] for asset in assets], ["summary"])


if __name__ == "__main__":
    unittest.main()

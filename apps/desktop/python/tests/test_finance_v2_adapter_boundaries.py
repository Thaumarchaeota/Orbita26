"""Synthetic boundary checks for the public Finance v2 adapter and bridge."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile
import xml.etree.ElementTree as ET

from openpyxl import Workbook

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from finance_v2_adapters.artifact import parse_artifact
from finance_v2_adapters.bridge import _run
from finance_v2_adapters.contract import BindingSnapshot, ParseRequest
from finance_v2_adapters.profiles.wallet_csv_13 import HEADERS as CSV_HEADERS
from finance_v2_adapters.profiles.wallet_xlsx_11 import HEADERS as XLSX_HEADERS
from finance_v2_adapters.contract import CONTRACT_VERSION


def _request(profile: str, content: bytes, revision: str = "1") -> ParseRequest:
    return ParseRequest(
        artifact_id="synthetic-fixture",
        source_bytes=content,
        profile_id=profile,
        profile_revision=revision,
        binding_snapshot=BindingSnapshot(revision="binding-1"),
    )


def _xlsx_with_formula_cache() -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"
    sheet.append(XLSX_HEADERS)
    sheet.append(["2026-10-20 12:00:00", "支付", "示例商户", "商品", "支出", "=1+2", "银行卡", "成功", "order-1", "merchant-1", "备注"])
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()

    source = zipfile.ZipFile(io.BytesIO(output.getvalue()), "r")
    rewritten = io.BytesIO()
    with source, zipfile.ZipFile(rewritten, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            payload = source.read(info.filename)
            if info.filename == "xl/worksheets/sheet1.xml":
                root = ET.fromstring(payload)
                ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                cell = root.find(f".//{ns}c[@r='F2']")
                assert cell is not None
                value = cell.find(f"{ns}v")
                if value is None:
                    value = ET.SubElement(cell, f"{ns}v")
                value.text = "3"
                payload = ET.tostring(root, encoding="utf-8", xml_declaration=True)
            target.writestr(info, payload)
    return rewritten.getvalue()


class FinanceV2AdapterBoundaries(unittest.TestCase):
    def test_csv_preserves_multiline_record_occurrences_and_direction_totals(self) -> None:
        rows = [
            CSV_HEADERS,
            ["2026-10-20 12:00:00", "消费", "店铺, 一号", "", '咖啡\n加点', "支出", "12.50", "卡", "成功", "same", "", "", ""],
            ["2026-10-20 12:01:00", "退款", "店铺, 一号", "", "退款", "收入", "12.50", "卡", "成功", "same", "", "", ""],
        ]
        content = ("\ufeff" + "\r\n".join(",".join('"' + value.replace('"', '""') + '"' for value in row) for row in rows) + "\r\n").encode("utf-8")
        result = parse_artifact(_request("wallet-csv-13/v1", content))

        self.assertEqual([item.occurrence_discriminator for item in result.occurrences], ["csv-record:1", "csv-record:2"])
        self.assertNotEqual(result.occurrences[0].locator, result.occurrences[1].locator)
        self.assertIn("lines/2-3", result.occurrences[0].locator)
        self.assertEqual(result.occurrences[0].raw_fields[2].value_text, "店铺, 一号")
        self.assertEqual(result.occurrences[0].raw_fields[4].value_text, "咖啡\n加点")
        self.assertEqual(result.occurrences[0].source_direction_text, "支出")
        self.assertEqual(result.occurrences[1].source_direction_text, "收入")
        self.assertEqual(result.quality.denominator_status, "unavailable")
        self.assertEqual({(row[1], row[2], row[3]) for row in result.quality.amount_totals}, {
            ("支出", "positive", "unprovided|wallet_event_amount"),
            ("收入", "positive", "unprovided|wallet_event_amount"),
        })

    def test_parser_and_bridge_reject_unregistered_profile_revision(self) -> None:
        result = parse_artifact(_request("wallet-csv-13/v1", b"", "999"))
        self.assertEqual(result.status, "unsupported")
        self.assertEqual(result.error_code, "unsupported_profile_revision")

        envelope = {
            "contract_version": CONTRACT_VERSION,
            "artifact_id": "synthetic-fixture",
            "source_bytes_base64": base64.b64encode(b"").decode("ascii"),
            "detected_media_type": "csv",
            "profile_id": "wallet-csv-13/v1",
            "profile_revision": "999",
            "binding_snapshot": {
                "revision": "binding-1",
                "account_hint_to_ids": [],
                "via_hint_to_ids": [],
                "artifact_account_ids": [],
                "artifact_via_ids": [],
            },
        }
        response = json.loads(_run(json.dumps(envelope).encode("utf-8")))
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"], "unsupported_profile_revision")

    def test_formula_cache_is_retained_as_untrusted_provenance_and_fails_row(self) -> None:
        result = parse_artifact(_request("wallet-xlsx-11/v1", _xlsx_with_formula_cache()))
        self.assertEqual(len(result.occurrences), 1)
        row = result.occurrences[0]
        self.assertEqual(row.status, "failure")
        self.assertTrue(any("formula_cache_untrusted_column_6" in code for code in row.failure_codes))
        self.assertEqual(row.raw_fields[5].source_type, "formula_cached")
        self.assertEqual(row.raw_fields[5].value_text, "=1+2")
        self.assertEqual(row.raw_fields[5].cached_value_text, "3")
        self.assertEqual(row.untrusted_observations[0].semantic_role, "wallet_event_amount")
        self.assertEqual(row.untrusted_observations[0].formula_text, "=1+2")
        self.assertEqual(row.untrusted_observations[0].cached_value_text, "3")
        self.assertTrue(row.untrusted_observations[0].cache_present)
        self.assertEqual(row.amount_observations, ())
        # The date cell itself is ordinary source text; the failed row status
        # prevents the row from being confirmed as a whole.
        self.assertEqual(len(row.date_observations), 1)
        self.assertEqual(row.date_observations[0].raw_text, "2026-10-20 12:00:00")
        self.assertEqual(
            [(item.namespace, item.value_text) for item in row.external_ids],
            [("wallet.transaction", "order-1"), ("wallet.merchant", "merchant-1")],
        )


if __name__ == "__main__":
    unittest.main()

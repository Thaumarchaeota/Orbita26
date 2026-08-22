import json
import os
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.services.ledger_item import item_to_dict
from ledger.services.parser import invalidate_parse_cache, parse_write_target
from ledger.services.settings import get_write_target
from ledger.tests.bill_isolation import isolate_bill_root, restore_bill_root


def _bill_root() -> Path:
    return Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])


def _setup_write_target(content: str) -> str:
    bill = _bill_root()
    target = get_write_target()
    (bill / "ledger").mkdir(parents=True, exist_ok=True)
    (bill / target).write_text(content, encoding="utf-8")
    (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
    (bill / ".bkeasy/settings.json").write_text(
        '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
        encoding="utf-8",
    )
    return target


class EntriesApiMetadataTests(unittest.TestCase):
    def setUp(self):
        self._bill_root, self._prev_root, self._created_root = isolate_bill_root()

    def tearDown(self):
        restore_bill_root(self._prev_root, self._created_root)

    def test_parse_write_target_matches_entries_api_shape(self):
        _setup_write_target(
            '2026-03-01 * "测试" "午餐"\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
            '    bkeasy-type: "expense"\n'
            "    bkeasy-type:\n"
            '      bkeasy-type: "proxy-expense"\n'
            "\tbkeasy-type: \"repayment\"\n"
        )
        invalidate_parse_cache()
        parsed = parse_write_target()
        entries = [item_to_dict(item) for item in parsed.items]
        txns = [e for e in entries if e.get("kind") == "transaction"]
        self.assertEqual(len(txns), 1)
        txn = txns[0]
        for posting in txn["postings"]:
            self.assertNotIn("bkeasy-type", posting["account"])
            self.assertNotEqual(posting["account"].strip(), "bkeasy-type:")
            self.assertNotEqual(float(posting["amount"]), 0.0)
        meta = txn.get("metadata") or []
        self.assertTrue(any(m["key"] == "bkeasy-type" for m in meta))
        self.assertEqual(txn["type"], "repayment")

    def test_live_api_entries_no_bkeasy_posting(self):
        bill = _bill_root()
        target = _setup_write_target(
            '2026-03-01 * "测试" "午餐"\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
            '    bkeasy-type: "expense"\n'
            "    bkeasy-type:\n"
            '      bkeasy-type: "proxy-expense"\n'
            "\tbkeasy-type: \"repayment\"\n"
        )
        invalidate_parse_cache()
        port = "18081"
        env = os.environ.copy()
        env["ORBITA_LEDGER_DATA_ROOT"] = str(bill)
        env["ORBITA_LEDGER_PORT"] = port
        proc = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "ledger.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                port,
            ],
            cwd=str(PYTHON_ROOT),
            env=env,
        )
        try:
            for _ in range(50):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.5)
                    break
                except (urllib.error.URLError, TimeoutError):
                    time.sleep(0.1)
            else:
                self.fail("sidecar test server did not start")
            raw = urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/entries",
                timeout=5,
            ).read()
            payload = json.loads(raw)
            txns = [e for e in payload["entries"] if e.get("kind") == "transaction"]
            self.assertEqual(len(txns), 1)
            txn = txns[0]
            for posting in txn["postings"]:
                self.assertNotIn("bkeasy-type", posting["account"])
                self.assertNotEqual(posting["account"].strip(), "bkeasy-type:")
                self.assertNotEqual(float(posting["amount"]), 0.0)
            self.assertEqual(txn["type"], "repayment")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    raise SystemExit(unittest.main())

import importlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="orbita-ledger-delete-scan-"))


def _activate_test_root() -> None:
    os.environ["ORBITA_LEDGER_DATA_ROOT"] = str(_TEST_ROOT)
    import ledger.config as cfg

    importlib.reload(cfg)
    for mod_name in (
        "ledger.services.account_common",
        "ledger.services.accounts",
        "ledger.services.account_delete_scan",
    ):
        importlib.reload(importlib.import_module(mod_name))


def _write_fixture(
    *,
    account_lines: str = "",
    category_lines: str = "",
    ledger_files: dict[str, str] | None = None,
) -> None:
    from ledger.config import DATA_DIR

    bill = DATA_DIR
    if bill.exists():
        shutil.rmtree(bill)
    bill.mkdir(parents=True, exist_ok=True)
    (bill / "account.bean").write_text(account_lines, encoding="utf-8")
    (bill / "category.bean").write_text(category_lines, encoding="utf-8")
    ledger_dir = bill / "ledger"
    ledger_dir.mkdir(parents=True, exist_ok=True)
    for rel, content in (ledger_files or {}).items():
        (bill / rel).write_text(content, encoding="utf-8")
    (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
    (bill / ".bkeasy/settings.json").write_text(
        '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
        encoding="utf-8",
    )


class AccountDeleteScanTests(unittest.TestCase):
    def setUp(self):
        _activate_test_root()
        from ledger.services.account_delete_scan import scan_account_delete

        self.scan_account_delete = scan_account_delete

    def test_zero_refs_no_children_can_delete(self):
        _write_fixture(
            account_lines=(
                "2026-01-01 open Assets:Cash CNY ;现金\n"
                "2026-01-01 open Assets:Bank CNY ;银行\n"
            ),
            category_lines="2026-01-01 open Expenses:Food ;餐饮\n",
            ledger_files={
                "ledger/2026.bean": (
                    '2026-03-01 * "午餐" ""\n'
                    "    Expenses:Food                   20.00 CNY\n"
                    "    Assets:Bank                    -20.00 CNY\n"
                ),
            },
        )
        result = self.scan_account_delete("Assets:Cash")
        self.assertTrue(result["ok"])
        self.assertTrue(result["exists"])
        self.assertTrue(result["can_delete"])
        self.assertEqual(result["references"], [])
        self.assertEqual(result["child_accounts"], [])

    def test_transaction_posting_blocks_delete(self):
        _write_fixture(
            account_lines="2026-01-01 open Assets:Cash CNY ;现金\n",
            category_lines="2026-01-01 open Expenses:Food ;餐饮\n",
            ledger_files={
                "ledger/2026.bean": (
                    '2026-03-01 * "咖啡" ""\n'
                    "    Expenses:Food                   10.00 CNY\n"
                    "    Assets:Cash                    -10.00 CNY\n"
                ),
            },
        )
        result = self.scan_account_delete("Assets:Cash")
        self.assertFalse(result["can_delete"])
        self.assertEqual(result["reference_count"], 1)
        ref = result["references"][0]
        self.assertEqual(ref["kind"], "transaction")
        self.assertEqual(ref["field"], "posting")
        self.assertEqual(ref["source_file"], "ledger/2026.bean")
        self.assertEqual(ref["account"], "Assets:Cash")

    def test_pad_and_balance_refs_block_delete(self):
        _write_fixture(
            account_lines=(
                "2026-01-01 open Assets:Cash CNY ;现金\n"
                "2026-01-01 open Equity:Opening-Balances ;期初\n"
            ),
            ledger_files={
                "ledger/2026.bean": (
                    "2026-03-01 pad Assets:Cash Equity:Opening-Balances\n"
                    "2026-03-02 balance Assets:Cash  100.00 CNY\n"
                ),
            },
        )
        cash = self.scan_account_delete("Assets:Cash")
        self.assertFalse(cash["can_delete"])
        self.assertEqual(cash["reference_count"], 2)
        kinds = {ref["kind"] for ref in cash["references"]}
        self.assertEqual(kinds, {"pad", "balance"})

        equity = self.scan_account_delete("Equity:Opening-Balances")
        self.assertFalse(equity["can_delete"])
        self.assertEqual(equity["references"][0]["field"], "source_account")

    def test_child_accounts_block_delete(self):
        _write_fixture(
            account_lines=(
                "2026-01-01 open Assets:Cash CNY ;现金\n"
                "2026-01-01 open Assets:Cash:Wallet CNY ;钱包\n"
            ),
        )
        result = self.scan_account_delete("Assets:Cash")
        self.assertFalse(result["can_delete"])
        self.assertEqual(result["child_accounts"], ["Assets:Cash:Wallet"])
        self.assertEqual(result["references"], [])

    def test_scans_all_ledger_year_files(self):
        _write_fixture(
            account_lines="2026-01-01 open Assets:Cash CNY ;现金\n",
            category_lines="2026-01-01 open Expenses:Food ;餐饮\n",
            ledger_files={
                "ledger/2025.bean": (
                    '2025-12-31 * "旧账" ""\n'
                    "    Expenses:Food                   5.00 CNY\n"
                    "    Assets:Cash                    -5.00 CNY\n"
                ),
                "ledger/2026.bean": "",
            },
        )
        result = self.scan_account_delete("Assets:Cash")
        self.assertFalse(result["can_delete"])
        self.assertEqual(result["reference_count"], 1)
        self.assertEqual(result["references"][0]["source_file"], "ledger/2025.bean")

    def test_missing_account_not_deletable(self):
        _write_fixture()
        result = self.scan_account_delete("Assets:Missing")
        self.assertFalse(result["exists"])
        self.assertFalse(result["can_delete"])

    def test_empty_name_rejected(self):
        with self.assertRaises(ValueError):
            self.scan_account_delete("")


if __name__ == "__main__":
    raise SystemExit(unittest.main())

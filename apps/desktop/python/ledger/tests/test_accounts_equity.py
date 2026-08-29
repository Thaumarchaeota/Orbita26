import importlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))


class AccountsEquityTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="orbita-ledger-accounts-equity-"))
        os.environ["ORBITA_LEDGER_DATA_ROOT"] = str(self.root)
        import ledger.config as cfg

        importlib.reload(cfg)
        self.accounts = importlib.reload(importlib.import_module("ledger.services.accounts"))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_list_accounts_exposes_equity_from_account_file(self):
        from ledger.config import DATA_DIR

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        (DATA_DIR / "account.bean").write_text(
            "2026-01-01 open Assets:Cash CNY ;现金\n"
            "2026-01-01 open Equity:Opening-Balances CNY ;期初\n",
            encoding="utf-8",
        )
        (DATA_DIR / "category.bean").write_text("", encoding="utf-8")

        groups = self.accounts.list_accounts()
        self.assertEqual([item["name"] for item in groups["equity"]], ["Equity:Opening-Balances"])
        self.assertIn("Equity:Opening-Balances", self.accounts.all_accounts())


if __name__ == "__main__":
    raise SystemExit(unittest.main())

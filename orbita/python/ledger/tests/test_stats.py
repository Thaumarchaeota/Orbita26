import os
import sys
import unittest
from datetime import date
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import assert_safe_ledger_test_root, LedgerBillIsolationMixin

from ledger.services.stats import compute_account_balances, get_stats


def _bill_root() -> Path:
    return Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])


def _setup_bill(
    *,
    ledger: str,
    account_bean: str | None = None,
    category_bean: str | None = None,
) -> None:
    assert_safe_ledger_test_root()
    bill = _bill_root()
    bill.mkdir(parents=True, exist_ok=True)
    (bill / "ledger").mkdir(parents=True, exist_ok=True)
    target = "ledger/2026.bean"
    (bill / target).write_text(ledger, encoding="utf-8")
    (bill / "account.bean").write_text(
        account_bean
        or (
            "2026-01-01 open Assets:Cash CNY ;现金\n"
            "2026-01-01 open Liabilities:Card CNY ;信用卡\n"
            "2026-01-01 open Equity:Opening\n"
        ),
        encoding="utf-8",
    )
    (bill / "category.bean").write_text(
        category_bean
        or (
            "2026-01-01 open Expenses:Food CNY ;餐饮\n"
            "2026-01-01 open Income:Salary CNY ;工资\n"
        ),
        encoding="utf-8",
    )
    (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
    (bill / ".bkeasy/settings.json").write_text(
        '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
        encoding="utf-8",
    )


class StatsTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_balance_pass_and_amounts(self):
        _setup_bill(
            ledger=(
                "2026-01-02 * \"午餐\"\n"
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
                "\n"
                "2026-01-03 balance Assets:Cash  -20.00 CNY\n"
            ),
        )
        result = compute_account_balances()
        self.assertTrue(result["ok"], result)
        cash = next(a for a in result["accounts"] if a["account"] == "Assets:Cash")
        self.assertEqual(cash["assertion_status"], "pass")
        self.assertEqual(cash["assertion_date"], "2026-01-03")
        self.assertEqual(cash["balances"], [{"currency": "CNY", "amount": "-20"}])

    def test_balance_fail(self):
        _setup_bill(
            ledger=(
                "2026-01-02 * \"午餐\"\n"
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
                "\n"
                "2026-01-03 balance Assets:Cash  -10.00 CNY\n"
            ),
        )
        result = compute_account_balances()
        self.assertTrue(result["ok"], result)
        cash = next(a for a in result["accounts"] if a["account"] == "Assets:Cash")
        self.assertEqual(cash["assertion_status"], "fail")
        self.assertEqual(cash["balances"], [{"currency": "CNY", "amount": "-20"}])

    def test_no_assertion(self):
        _setup_bill(
            ledger=(
                "2026-01-02 * \"午餐\"\n"
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_balances()
        self.assertTrue(result["ok"])
        cash = next(a for a in result["accounts"] if a["account"] == "Assets:Cash")
        self.assertEqual(cash["assertion_status"], "none")
        self.assertIsNone(cash["assertion_date"])

    def test_month_expenses_from_postings(self):
        month = date.today().strftime("%Y-%m")
        _setup_bill(
            ledger=(
                f"{month}-02 * \"午餐\"\n"
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
                "\n"
                f"{month}-03 * \"咖啡\"\n"
                "  Expenses:Food                   15.00 CNY\n"
                "  Assets:Cash                    -15.00 CNY\n"
            ),
        )
        stats = get_stats()
        self.assertTrue(stats["ok"])
        self.assertEqual(stats["month_expenses_total"], 35.0)
        self.assertEqual(len(stats["month_expenses_by_category"]), 1)
        self.assertEqual(stats["month_expenses_by_category"][0]["account"], "Expenses:Food")
        self.assertEqual(stats["month_expenses_by_category"][0]["total"], 35.0)


    def test_month_income_from_postings(self):
        month = date.today().strftime("%Y-%m")
        _setup_bill(
            ledger=(
                f"{month}-02 * \"工资\"\n"
                "  Income:Salary                 -5000.00 CNY\n"
                "  Assets:Cash                    5000.00 CNY\n"
                "\n"
                f"{month}-15 * \"奖金\"\n"
                "  Income:Salary                 -1000.00 CNY\n"
                "  Assets:Cash                    1000.00 CNY\n"
            ),
        )
        stats = get_stats()
        self.assertTrue(stats["ok"])
        self.assertEqual(stats["month_income_total"], 6000.0)
        self.assertEqual(len(stats["month_income_by_category"]), 1)
        self.assertEqual(stats["month_income_by_category"][0]["account"], "Income:Salary")
        self.assertEqual(stats["month_income_by_category"][0]["total"], 6000.0)


if __name__ == "__main__":
    unittest.main()

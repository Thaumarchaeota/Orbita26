import os
import sys
import unittest
from datetime import date
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import assert_safe_ledger_test_root, LedgerBillIsolationMixin

from ledger.services.stats import compute_account_balances, compute_account_period_stats, get_stats
from ledger.services.parser import invalidate_parse_cache


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
    invalidate_parse_cache()


class StatsTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_balance_pass_and_amounts(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
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
                '2026-01-02 * "午餐" "餐饮"\n'
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
                '2026-01-02 * "午餐" "餐饮"\n'
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

    def test_account_period_stats_opening_flows_and_closing(self):
        _setup_bill(
            ledger=(
                '2025-12-31 * "期初" "余额"\n'
                "  Assets:Cash                   100.00 CNY\n"
                "  Equity:Opening               -100.00 CNY\n"
                "\n"
                '2026-01-05 * "收入" "工资"\n'
                "  Assets:Cash                    50.00 CNY\n"
                "  Income:Salary                 -50.00 CNY\n"
                "\n"
                '2026-01-10 * "支出" "餐饮"\n'
                "  Expenses:Food                  30.00 CNY\n"
                "  Assets:Cash                   -30.00 CNY\n"
            ),
            account_bean=(
                "2025-01-01 open Assets:Cash CNY ;现金\n"
                "2025-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["account_kind"], "asset")
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["opening_balance"], "100")
        self.assertEqual(cny["inflows"], "50")
        self.assertEqual(cny["outflows"], "30")
        self.assertEqual(cny["net_change"], "20")
        self.assertEqual(cny["closing_balance"], "120")
        self.assertEqual(cny["transaction_count"], 2)

    def test_account_period_stats_uses_at_total_cost_not_lot(self):
        _setup_bill(
            ledger=(
                '2026-03-01 * "八达通" "充值"\n'
                "  Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
                "  Assets:Receivable:Family\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Card:Octopus HKD\n"
                "2026-01-01 open Assets:Receivable:Family CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Card:Octopus",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "290")
        self.assertEqual(cny["net_change"], "-290")
        self.assertEqual(cny["closing_balance"], "0")
        self.assertEqual(cny["transaction_count"], 1)
        hkd = next(c for c in result["currencies"] if c["currency"] == "HKD")
        self.assertEqual(hkd["closing_balance"], "-332")
        self.assertEqual(hkd["inflows"], "0")
        self.assertEqual(hkd["outflows"], "0")
        self.assertEqual(hkd["net_change"], "0")
        self.assertEqual(hkd["transaction_count"], 0)

    def test_account_period_stats_at_total_cost_coexists_with_balance(self):
        _setup_bill(
            ledger=(
                '2025-12-31 * "期初" "余额"\n'
                "  Assets:Card:Octopus           100.00 HKD\n"
                "  Equity:Opening               -100.00 HKD\n"
                "\n"
                '2026-03-01 * "八达通" "充值"\n'
                "  Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
                "  Assets:Receivable:Family\n"
            ),
            account_bean=(
                "2025-01-01 open Assets:Card:Octopus HKD\n"
                "2025-01-01 open Assets:Receivable:Family CNY\n"
                "2025-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Card:Octopus",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(result["ok"], result)
        hkd = next(c for c in result["currencies"] if c["currency"] == "HKD")
        self.assertEqual(hkd["opening_balance"], "100")
        self.assertEqual(hkd["closing_balance"], "-232")
        self.assertEqual(hkd["net_change"], "0")
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "290")
        self.assertEqual(cny["net_change"], "-290")
        self.assertEqual(cny["closing_balance"], "0")

    def test_account_period_stats_no_cost_uses_units_for_flows(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "港币" "入账"\n'
                "  Assets:Cash                    50.00 HKD\n"
                "  Equity:Opening                -50.00 HKD\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Cash HKD\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        hkd = next(c for c in result["currencies"] if c["currency"] == "HKD")
        self.assertEqual(hkd["inflows"], "50")
        self.assertEqual(hkd["net_change"], "50")
        self.assertEqual(hkd["closing_balance"], "50")

    def test_account_period_stats_metadata_does_not_create_postings(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "pay" "remark"\n'
                '  time: "2026-01-02T12:00:00+08:00"\n'
                '  bkeasy-type: "expense"\n'
                '  orbita-id: "abc"\n'
                "  Expenses:Food                  20.00 CNY\n"
                "  Assets:Cash                   -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "20")
        self.assertEqual(cny["net_change"], "-20")
        self.assertEqual(cny["closing_balance"], "-20")
        self.assertEqual(cny["transaction_count"], 1)

    def test_account_period_stats_multiple_metadata_lines(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "pay" "remark"\n'
                '  time: "2026-01-02T12:00:00+08:00"\n'
                '  bkeasy-type: "expense"\n'
                '  orbita-id: "abc"\n'
                '  note: "lunch"\n'
                "  Expenses:Food                  20.00 CNY\n"
                "  Assets:Cash                   -20.00 CNY\n"
                "\n"
                '2026-01-03 * "pay2" "remark2"\n'
                '  time: "2026-01-03T18:00:00+08:00"\n'
                '  orbita-id: "def"\n'
                "  Expenses:Food                  15.00 CNY\n"
                "  Assets:Cash                   -15.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "35")
        self.assertEqual(cny["net_change"], "-35")
        self.assertEqual(cny["transaction_count"], 2)

    def test_account_period_stats_combined_at_lot_and_at_total_cost(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "外汇" "换汇"\n'
                "  Assets:Usd                    100.00 USD @ 7.00 CNY\n"
                "  Assets:Cny                   -700.00 CNY\n"
                "\n"
                '2026-01-03 * "买入" "基金"\n'
                "  Assets:Fund                     10 HOOL {70 CNY}\n"
                "  Assets:Cny                   -700.00 CNY\n"
                "\n"
                '2026-03-01 * "八达通" "充值"\n'
                "  Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
                "  Assets:Receivable:Family\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Usd USD\n"
                "2026-01-01 open Assets:Cny CNY\n"
                "2026-01-01 open Assets:Fund HOOL\n"
                "2026-01-01 open Assets:Card:Octopus HKD\n"
                "2026-01-01 open Assets:Receivable:Family CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        usd_result = compute_account_period_stats(
            "Assets:Usd",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(usd_result["ok"], usd_result)
        usd = next(c for c in usd_result["currencies"] if c["currency"] == "USD")
        self.assertEqual(usd["inflows"], "100")
        self.assertNotIn("CNY", {c["currency"] for c in usd_result["currencies"] if c["inflows"] != "0"})

        fund_result = compute_account_period_stats(
            "Assets:Fund",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(fund_result["ok"], fund_result)
        hool = next(c for c in fund_result["currencies"] if c["currency"] == "HOOL")
        self.assertEqual(hool["inflows"], "10")

        octopus_result = compute_account_period_stats(
            "Assets:Card:Octopus",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(octopus_result["ok"], octopus_result)
        hkd = next(c for c in octopus_result["currencies"] if c["currency"] == "HKD")
        cny = next(c for c in octopus_result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(hkd["closing_balance"], "-332")
        self.assertEqual(hkd["net_change"], "0")
        self.assertEqual(cny["outflows"], "290")
        self.assertEqual(cny["net_change"], "-290")

    def test_account_period_stats_lot_cost_uses_native_units(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "买入" "基金"\n'
                "  Assets:Fund                     10 HOOL {70 CNY}\n"
                "  Assets:Cash                   -700.00 CNY\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Cash CNY\n"
                "2026-01-01 open Assets:Fund HOOL\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Fund",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        hool = next(c for c in result["currencies"] if c["currency"] == "HOOL")
        self.assertEqual(hool["inflows"], "10")
        self.assertEqual(hool["transaction_count"], 1)
        cny_rows = [c for c in result["currencies"] if c["currency"] == "CNY"]
        self.assertEqual(cny_rows, [])

    def test_account_period_stats_at_price_uses_native_units(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "外汇" "换汇"\n'
                "  Assets:Cash                   100.00 USD @ 7.00 CNY\n"
                "  Assets:CNY                   -700.00 CNY\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Cash USD\n"
                "2026-01-01 open Assets:CNY CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        usd = next(c for c in result["currencies"] if c["currency"] == "USD")
        self.assertEqual(usd["inflows"], "100")
        cny_rows = [c for c in result["currencies"] if c["currency"] == "CNY"]
        self.assertEqual(cny_rows, [])

    def test_account_period_stats_same_currency_without_at(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "20")
        self.assertEqual(cny["net_change"], "-20")

    def test_account_period_stats_mixed_currencies(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "港币" "入账"\n'
                "  Assets:Cash                    50.00 HKD\n"
                "  Equity:Opening                -50.00 HKD\n"
                "\n"
                '2026-01-03 * "人民币" "入账"\n'
                "  Assets:Cash                    30.00 CNY\n"
                "  Equity:Opening                -30.00 CNY\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Cash\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        hkd = next(c for c in result["currencies"] if c["currency"] == "HKD")
        self.assertEqual(cny["inflows"], "30")
        self.assertEqual(hkd["inflows"], "50")

    def test_account_period_stats_rejects_expense_account(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Expenses:Food",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("仅支持资产或负债账户", result["error"])

    def test_account_period_stats_parse_error_returns_not_ok(self):
        _setup_bill(
            ledger='include "missing.bean"\n',
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("error", result)
        self.assertNotIn("currencies", result)

    def test_account_period_stats_rejects_unknown_account(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Missing",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("账户不存在", result["error"])

    def test_account_period_stats_allows_declared_parent_with_children(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Card                    -20.00 CNY\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Card CNY\n"
                "2026-01-01 open Assets:Card:Octopus HKD\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Card",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)

    def test_account_period_stats_nested_include_closure(self):
        bill = _bill_root()
        bill.mkdir(parents=True, exist_ok=True)
        (bill / "ledger").mkdir(parents=True, exist_ok=True)
        (bill / "ledger" / "2026.bean").write_text(
            'include "entries.bean"\n',
            encoding="utf-8",
        )
        (bill / "ledger" / "entries.bean").write_text(
            (
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
            encoding="utf-8",
        )
        (bill / "account.bean").write_text(
            "2026-01-01 open Assets:Cash CNY ;现金\n"
            "2026-01-01 open Equity:Opening\n",
            encoding="utf-8",
        )
        (bill / "category.bean").write_text(
            "2026-01-01 open Expenses:Food CNY ;餐饮\n",
            encoding="utf-8",
        )
        (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
        (bill / ".bkeasy/settings.json").write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        invalidate_parse_cache()
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["outflows"], "20")

    def test_account_period_stats_missing_write_target_fails(self):
        bill = _bill_root()
        bill.mkdir(parents=True, exist_ok=True)
        (bill / "account.bean").write_text(
            "2026-01-01 open Assets:Cash CNY ;现金\n"
            "2026-01-01 open Equity:Opening\n",
            encoding="utf-8",
        )
        (bill / "category.bean").write_text(
            "2026-01-01 open Expenses:Food CNY ;餐饮\n",
            encoding="utf-8",
        )
        (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
        (bill / ".bkeasy/settings.json").write_text(
            '{"write_target":"ledger/missing.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        invalidate_parse_cache()
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result.get("kind"), "ledger")
        self.assertNotIn("currencies", result)

    def test_account_period_stats_rejects_single_sided_date_from(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
        )
        self.assertFalse(result["ok"])
        self.assertIn("须同时提供", result["error"])

    def test_account_period_stats_rejects_single_sided_date_to(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("须同时提供", result["error"])

    def test_account_period_stats_at_comment_with_double_at_uses_units(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "外汇" "换汇"\n'
                "  Assets:Cash                   100.00 USD @ 7.00 CNY ; @@ note\n"
                "  Assets:CNY                   -700.00 CNY\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Cash USD\n"
                "2026-01-01 open Assets:CNY CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        usd = next(c for c in result["currencies"] if c["currency"] == "USD")
        self.assertEqual(usd["inflows"], "100")
        self.assertEqual(usd["net_change"], "100")
        cny_rows = [c for c in result["currencies"] if c["currency"] == "CNY"]
        self.assertEqual(cny_rows, [])

    def test_account_period_stats_metadata_double_at_no_false_total_cost(self):
        _setup_bill(
            ledger=(
                '2026-03-01 * "八达通" "充值"\n'
                '  note: "paid @@ 290 CNY total"\n'
                "  Assets:Card:Octopus           -332.00 HKD @ 0.87 CNY\n"
                "  Assets:Receivable:Family\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Card:Octopus HKD\n"
                "2026-01-01 open Assets:Receivable:Family CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Card:Octopus",
            date_from="2026-01-01",
            date_to="2026-12-31",
        )
        self.assertTrue(result["ok"], result)
        hkd = next(c for c in result["currencies"] if c["currency"] == "HKD")
        self.assertEqual(hkd["outflows"], "332")
        self.assertEqual(hkd["net_change"], "-332")
        cny_rows = [c for c in result["currencies"] if c["currency"] == "CNY"]
        self.assertEqual(cny_rows, [])

    def test_account_period_stats_balance_assertion_failure_fails(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
                "\n"
                "2026-01-03 balance Assets:Cash  -10.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("error", result)
        self.assertNotIn("currencies", result)

    def test_account_period_stats_syntax_error_fails(self):
        _setup_bill(
            ledger='include "missing.bean"\n',
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertFalse(result["ok"])
        self.assertIn("error", result)
        self.assertNotIn("currencies", result)

    def test_account_period_stats_normal_ledger_succeeds(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats(
            "Assets:Cash",
            date_from="2026-01-01",
            date_to="2026-01-31",
        )
        self.assertTrue(result["ok"], result)
        self.assertIn("currencies", result)

    def test_account_period_stats_without_dates_at_total_cost_unit_only(self):
        _setup_bill(
            ledger=(
                '2026-03-01 * "八达通" "充值"\n'
                "  Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
                "  Assets:Receivable:Family\n"
            ),
            account_bean=(
                "2026-01-01 open Assets:Card:Octopus HKD\n"
                "2026-01-01 open Assets:Receivable:Family CNY\n"
                "2026-01-01 open Equity:Opening\n"
            ),
        )
        result = compute_account_period_stats("Assets:Card:Octopus")
        self.assertTrue(result["ok"], result)
        currencies = {c["currency"]: c for c in result["currencies"]}
        self.assertIn("HKD", currencies)
        self.assertEqual(currencies["HKD"]["balance"], "-332")
        self.assertNotIn("CNY", currencies)

    def test_account_period_stats_without_dates_returns_balance(self):
        _setup_bill(
            ledger=(
                '2026-01-02 * "午餐" "餐饮"\n'
                "  Expenses:Food                   20.00 CNY\n"
                "  Assets:Cash                    -20.00 CNY\n"
            ),
        )
        result = compute_account_period_stats("Assets:Cash")
        self.assertTrue(result["ok"], result)
        cny = next(c for c in result["currencies"] if c["currency"] == "CNY")
        self.assertEqual(cny["balance"], "-20")
        self.assertNotIn("opening_balance", cny)


if __name__ == "__main__":
    unittest.main()

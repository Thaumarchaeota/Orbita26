import os
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.services.parser import parse_file, parse_write_target
from ledger.services.ledger_item import Balance, Pad, Transaction, item_to_dict
from ledger.services.settings import get_write_target
from ledger.tests.bill_isolation import assert_safe_ledger_test_root, isolate_bill_root, restore_bill_root


def _bill_root() -> Path:
    return Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])


def _setup_write_target(content: str) -> str:
    assert_safe_ledger_test_root()
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


class ParserTests(unittest.TestCase):
    def setUp(self):
        self._bill_root, self._prev_root, self._created_root = isolate_bill_root()

    def tearDown(self):
        restore_bill_root(self._prev_root, self._created_root)

    def test_parse_transaction_with_metadata(self):
        target = _setup_write_target(
            '2026-03-01 * "星巴克" "咖啡" #food\n'
            "    Expenses:Food                   10.00 CNY\n"
            "    Assets:Cash                    -10.00 CNY\n"
            '  bkeasy-type: "expense"\n'
            '  orbita-id: "txn_01ARZ3NDEKTSV4RRFFQ69G5FAV"\n'
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        self.assertEqual(len(result.items), 1)
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(txn.kind, "transaction")
        self.assertEqual(txn.type, "expense")
        self.assertEqual(txn.payee, "星巴克")
        self.assertEqual(txn.tags, ["food"])
        self.assertEqual(txn.id, "txn_01ARZ3NDEKTSV4RRFFQ69G5FAV")
        self.assertEqual(len(txn.postings), 2)
        self.assertTrue(all(p.account != "bkeasy-type" for p in txn.postings))

    def test_parse_four_space_bkeasy_type_metadata_not_posting(self):
        target = _setup_write_target(
            '2026-03-01 * "测试" "午餐"\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
            '    bkeasy-type: "expense"\n'
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(txn.type, "expense")
        self.assertEqual(len(txn.postings), 2)
        self.assertTrue(all("bkeasy-type" not in p.account for p in txn.postings))
        self.assertTrue(any(m.key == "bkeasy-type" and m.value == "expense" for m in txn.metadata))

    def test_render_entry_round_trip_keeps_metadata_not_fake_posting(self):
        from ledger.services.models import Entry, Posting
        from ledger.services.render import render_entry

        entry = Entry(
            id="txn_test",
            source_file="ledger/2026.bean",
            source_line=1,
            type="income",
            date="2026-03-01",
            flag="*",
            payee="工资",
            remark="",
            tags="",
            postings=[
                Posting(account="Income:Salary", amount=-100.0, currency="CNY"),
                Posting(account="Assets:Cash", amount=100.0, currency="CNY"),
            ],
            seq="a0",
        )
        rendered = render_entry(entry)
        self.assertIn('  bkeasy-type: "income"', rendered)
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".bean", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(rendered)
            tmp_path = Path(tmp.name)
        try:
            result = parse_file(tmp_path, "ledger/2026.bean")
        finally:
            tmp_path.unlink(missing_ok=True)
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertEqual(txn.type, "income")
        self.assertEqual(len(txn.postings), 2)
        self.assertTrue(all("bkeasy-type" not in p.account for p in txn.postings))
        self.assertTrue(
            any(m.key == "bkeasy-type" and m.value == "income" for m in txn.metadata)
        )

    def test_parse_pad_and_balance(self):
        target = _setup_write_target(
            "2026-03-01 pad Assets:Cash Equity:Opening\n"
            "2026-03-02 balance Assets:Cash  100.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        self.assertEqual(len(result.items), 2)
        pad = result.items[0]
        bal = result.items[1]
        self.assertIsInstance(pad, Pad)
        self.assertEqual(pad.kind, "pad")
        self.assertEqual(pad.account, "Assets:Cash")
        self.assertEqual(pad.source_account, "Equity:Opening")
        self.assertIsInstance(bal, Balance)
        self.assertEqual(bal.kind, "balance")
        self.assertEqual(bal.amount, "100.00")
        self.assertEqual(bal.currency, "CNY")

    def test_whitelist_blocks_open_directive(self):
        target = _setup_write_target("2026-01-01 open Assets:Cash CNY\n")
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.items, [])
        self.assertEqual(len(result.diagnostics), 1)
        self.assertIn("第 1 行", result.diagnostics[0].message)
        self.assertIn("open", result.diagnostics[0].message)

    def test_whitelist_blocks_include(self):
        target = _setup_write_target('include "other.bean"\n')
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.items, [])
        self.assertTrue(any("include" in d.message for d in result.diagnostics))

    def test_whitelist_blocks_posting_flag(self):
        target = _setup_write_target(
            '2026-03-01 * "测试" ""\n'
            "  ! Assets:Cash                   -10.00 CNY\n"
            "    Expenses:Food                  10.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertTrue(any("posting flag" in d.message for d in result.diagnostics))

    def test_parses_single_at_price(self):
        target = _setup_write_target(
            '2026-03-01 * "测试" ""\n'
            "    Assets:Cash                   -70.00 CNY\n"
            "    Expenses:Food                  10.00 USD @ 7.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertEqual(txn.postings[1].price_amount, "7.00")
        self.assertEqual(txn.postings[1].price_currency, "CNY")

    def test_parse_write_target_returns_kind_in_dict(self):
        target = _setup_write_target(
            "2026-03-01 pad Assets:Cash Equity:Opening\n"
            '2026-03-02 * "午餐" ""\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
        )
        from ledger.services.parser import invalidate_parse_cache

        invalidate_parse_cache()
        result = parse_write_target()
        kinds = {item_to_dict(item)["kind"] for item in result.items}
        self.assertIn("pad", kinds)
        self.assertIn("transaction", kinds)

    def _txn_base(self) -> str:
        return (
            '2026-03-01 * "测试" "午餐"\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
        )

    def _assert_no_bkeasy_posting(self, txn: Transaction) -> None:
        self.assertEqual(len(txn.postings), 2)
        for posting in txn.postings:
            self.assertNotIn("bkeasy-type", posting.account)
            if posting.amount is not None:
                self.assertNotEqual(float(posting.amount), 0.0)
            self.assertNotEqual(posting.account.strip(), "bkeasy-type:")

    def test_user_bean_four_space_bkeasy_type(self):
        target = _setup_write_target(
            '2026-02-01 * "猎豹加速器" "季卡"\n'
            "    Assets:Card:8047               -110.00 CNY\n"
            "    Expenses:Digital:Services      110.00 CNY\n"
            '    bkeasy-type: "expense"\n'
        )
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertEqual(txn.type, "expense")
        self.assertTrue(
            any(m.key == "bkeasy-type" and m.value == "expense" for m in txn.metadata)
        )

    def test_bkeasy_type_empty_value_not_posting(self):
        target = _setup_write_target(self._txn_base() + "    bkeasy-type:\n")
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertTrue(any(m.key == "bkeasy-type" and m.value == "" for m in txn.metadata))

    def test_bkeasy_type_whitespace_after_colon_not_posting(self):
        target = _setup_write_target(self._txn_base() + "    bkeasy-type:   \n")
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertTrue(any(m.key == "bkeasy-type" for m in txn.metadata))

    def test_bkeasy_type_six_space_indent_not_posting(self):
        target = _setup_write_target(self._txn_base() + '      bkeasy-type: "proxy-expense"\n')
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertEqual(txn.type, "proxy-expense")

    def test_bkeasy_type_tab_indent_not_posting(self):
        target = _setup_write_target(self._txn_base() + '\tbkeasy-type: "repayment"\n')
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertEqual(txn.type, "repayment")

    def test_bkeasy_type_mixed_indent_not_posting(self):
        target = _setup_write_target(self._txn_base() + ' \t  bkeasy-type: "expense"\n')
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self._assert_no_bkeasy_posting(txn)
        self.assertEqual(txn.type, "expense")

    def test_parse_unknown_string_metadata_time(self):
        target = _setup_write_target(
            '2026-05-19 * "午餐" "测试"\n'
            '  time: "2026-05-19T14:32:00+08:00"\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
            '  bkeasy-type: "expense"\n'
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertTrue(any(m.key == "time" and m.value == "2026-05-19T14:32:00+08:00" for m in txn.metadata))

    def test_header_suffix_requires_explicit_tag_token(self):
        target = _setup_write_target(
            '2026-05-19 * "午餐" "测试" bare-suffix #food\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertTrue(any("仅支持 #tag" in d.message for d in result.diagnostics))
        txn = result.items[0]
        self.assertEqual(txn.tags, ["food"])

    def test_header_explicit_tags_are_preserved(self):
        target = _setup_write_target(
            '2026-05-19 * "午餐" "测试" #food #中文\n'
            "    Expenses:Food                   20.00 CNY\n"
            "    Assets:Cash                    -20.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        self.assertEqual(result.items[0].tags, ["food", "中文"])

    def test_two_space_no_amount_posting_not_metadata(self):
        """两空格、无金额的合法 posting 不得误判为 transaction metadata 或 bkeasy-type 假分录。"""
        target = _setup_write_target(
            '2026-03-01 * "测试" "午餐"\n'
            "  Assets:Cash\n"
            "    Expenses:Food                   20.00 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertFalse(any(m.key == "Assets" for m in txn.metadata))
        self.assertTrue(any(p.account.strip() == "Assets:Cash" for p in txn.postings))
        self._assert_no_bkeasy_posting(txn)
        self.assertEqual(len(txn.postings), 2)
        implicit = next(p for p in txn.postings if p.account.strip() == "Assets:Cash")
        self.assertIsNone(implicit.amount)

    def test_metadata_posting_and_invalid_metadata_triad(self):
        """metadata、posting、非法 metadata 三类输入分流互不吞噬。"""
        target = _setup_write_target(
            '2026-03-01 * "分流" "测试"\n'
            '  bkeasy-type: "expense"\n'
            "  Assets:Cash\n"
            "    Expenses:Food                   15.00 CNY\n"
            "    bkeasy-type: 0 CNY\n"
        )
        result = parse_file(_bill_root() / target, target)
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(txn.type, "expense")
        self.assertTrue(
            any(m.key == "bkeasy-type" and m.value == "expense" for m in txn.metadata)
        )
        self.assertFalse(any(m.key == "Assets" for m in txn.metadata))
        accounts = [p.account.strip() for p in txn.postings]
        self.assertIn("Assets:Cash", accounts)
        self.assertIn("Expenses:Food", accounts)
        self.assertNotIn("bkeasy-type:", accounts)
        self.assertNotIn("bkeasy-type", accounts)
        self.assertTrue(
            any("metadata 不得解析为 posting" in d.message for d in result.diagnostics)
        )
        self.assertEqual(len(txn.postings), 2)


if __name__ == "__main__":
    raise SystemExit(unittest.main())

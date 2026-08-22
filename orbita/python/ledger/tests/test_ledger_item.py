import os
import sys
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import assert_safe_ledger_test_root, LedgerBillIsolationMixin

from ledger.services.candidate_validate import validate_candidate_items
from ledger.services.ledger_item import (
    collect_identity_backfill,
    is_valid_orbita_id,
    item_from_dict,
    new_orbita_id,
    stable_orbita_id,
)
from ledger.services.ledger_item_validate import validate_ledger_items
from ledger.services.ledger_render import render_ledger_file
from ledger.services.settings import get_write_target


def _txn(
    *,
    item_id: str = "",
    date: str = "2026-03-01",
    seq: str = "a0",
    txn_type: str = "expense",
) -> dict:
    target = get_write_target()
    return {
        "kind": "transaction",
        "id": item_id,
        "source_file": target,
        "source_line": 1,
        "type": txn_type,
        "date": date,
        "flag": "*",
        "payee": "测试",
        "remark": "",
        "tags": "",
        "postings": [
            {"account": "Expenses:Food", "amount": 10.0, "currency": "CNY"},
            {"account": "Assets:Cash", "amount": -10.0, "currency": "CNY"},
        ],
        "seq": seq,
    }


class LedgerItemTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_new_orbita_id_format(self):
        oid = new_orbita_id()
        self.assertTrue(is_valid_orbita_id(oid))

    def test_rejects_inv_type(self):
        _, diags = validate_ledger_items([_txn(txn_type="inv")])
        self.assertTrue(any("inv" in d.message for d in diags))

    def test_rejects_duplicate_orbita_id(self):
        oid = new_orbita_id()
        items = [_txn(item_id=oid), _txn(item_id=oid, seq="a1")]
        _, diags = validate_ledger_items(items)
        self.assertTrue(any("重复" in d.message for d in diags))

    def test_rejects_duplicate_time_metadata_without_mutating_it(self):
        item = _txn(item_id="ledger/2026.bean:12")
        item["metadata"] = [
            {"key": "time", "value": "2026-03-01T08:00:00+08:00"},
            {"key": "time", "value": "2026-03-01T08:01:00+08:00"},
        ]
        parsed, diags = validate_ledger_items([item])
        self.assertTrue(any("metadata time" in d.message for d in diags))
        self.assertEqual(
            [(m.key, m.value) for m in parsed[0].metadata],
            [("time", "2026-03-01T08:00:00+08:00"), ("time", "2026-03-01T08:01:00+08:00")],
        )

    def test_allows_legacy_session_id(self):
        items = [_txn(item_id="ledger/2026.bean:12")]
        parsed, diags = validate_ledger_items(items)
        self.assertEqual(diags, [])
        self.assertEqual(len(parsed), 1)

    def test_render_assigns_orbita_id_for_legacy(self):
        items_dict = [_txn(item_id="ledger/2026.bean:12")]
        parsed, diags = validate_ledger_items(items_dict)
        self.assertEqual(diags, [])
        text = render_ledger_file(parsed, assign_ids=True)
        self.assertIn('orbita-id: "', text)
        self.assertIn("bkeasy-type: \"expense\"", text)

    def test_render_pad_and_balance(self):
        target = get_write_target()
        items = [
            {
                "kind": "pad",
                "id": "pad-1",
                "source_file": target,
                "source_line": 2,
                "date": "2026-03-01",
                "account": "Assets:Cash",
                "source_account": "Equity:Opening",
                "seq": "a1",
            },
            {
                "kind": "balance",
                "id": "bal-1",
                "source_file": target,
                "source_line": 3,
                "date": "2026-03-01",
                "account": "Assets:Cash",
                "amount": "100.00",
                "currency": "CNY",
                "seq": "a2",
            },
        ]
        parsed, diags = validate_ledger_items(items)
        self.assertEqual(diags, [])
        text = render_ledger_file(parsed, assign_ids=False)
        self.assertIn("pad Assets:Cash Equity:Opening", text)
        self.assertIn("balance Assets:Cash  100.00 CNY", text)

    def test_sort_by_date_and_seq(self):
        target = get_write_target()
        items = [
            {
                "kind": "balance",
                "id": "b2",
                "source_file": target,
                "source_line": 1,
                "date": "2026-03-02",
                "account": "Assets:Cash",
                "amount": "1.00",
                "currency": "CNY",
                "seq": "a0",
            },
            _txn(item_id="ledger/2026.bean:5", date="2026-03-01", seq="a1"),
        ]
        parsed, diags = validate_ledger_items(items)
        self.assertEqual(diags, [])
        text = render_ledger_file(parsed, assign_ids=False)
        self.assertLess(text.index("2026-03-01"), text.index("2026-03-02"))

    def test_parser_display_and_candidate_file_share_chronological_contract(self):
        from ledger.services.parser import sort_for_display

        target = get_write_target()
        dated = "2026-03-01"
        items = [
            {**_txn(item_id="ledger/2026.bean:1", date=dated, seq="a0"), "payee": "late", "metadata": [{"key": "time", "value": f"{dated}T18:20:00+08:00"}]},
            {**_txn(item_id="ledger/2026.bean:2", date=dated, seq="a10"), "payee": "early-a10", "metadata": [{"key": "time", "value": f"{dated}T08:05:00+08:00"}]},
            {**_txn(item_id="ledger/2026.bean:3", date=dated, seq="a2"), "payee": "early-a2", "metadata": [{"key": "time", "value": f"{dated}T08:05:00+08:00"}]},
            {**_txn(item_id="ledger/2026.bean:4", date=dated, seq="a1"), "payee": "no-time"},
            {
                "kind": "pad", "id": "pad", "source_file": target, "source_line": 5,
                "date": dated, "account": "Assets:Cash", "source_account": "Equity:Opening", "seq": "a3",
            },
            {
                "kind": "balance", "id": "balance", "source_file": target, "source_line": 6,
                "date": dated, "account": "Assets:Cash", "amount": "1.00", "currency": "CNY", "seq": "a4",
            },
            {**_txn(item_id="ledger/2026.bean:7", date="2026-03-02", seq="a0"), "payee": "newer"},
        ]
        parsed, diags = validate_ledger_items(items)
        self.assertEqual(diags, [])
        # Candidate/Commit file order: date ASC, then time ASC, then numeric seq.
        self.assertEqual(
            [item.id for item in parsed],
            ["ledger/2026.bean:3", "ledger/2026.bean:2", "ledger/2026.bean:1", "ledger/2026.bean:4", "pad", "balance", "ledger/2026.bean:7"],
        )
        text = render_ledger_file(parsed, assign_ids=False)
        self.assertLess(text.index('"early-a2"'), text.index('"early-a10"'))
        self.assertLess(text.index('"early-a10"'), text.index('"late"'))

        # Parser/UI display reverses only the date groups, never the time order.
        displayed = sort_for_display(parsed)
        self.assertEqual(
            [item.id for item in displayed],
            ["ledger/2026.bean:7", "ledger/2026.bean:3", "ledger/2026.bean:2", "ledger/2026.bean:1", "ledger/2026.bean:4", "pad", "balance"],
        )

    def test_identity_backfill_for_legacy(self):
        items_dict = [_txn(item_id="ledger/2026.bean:12")]
        parsed, diags = validate_ledger_items(items_dict)
        self.assertEqual(diags, [])
        backfill = collect_identity_backfill(parsed)
        self.assertEqual(len(backfill), 1)
        self.assertEqual(backfill[0]["from_id"], "ledger/2026.bean:12")
        self.assertTrue(is_valid_orbita_id(backfill[0]["id"]))
        self.assertEqual(
            backfill[0]["id"],
            stable_orbita_id("ledger/2026.bean:12"),
        )
        orbita_meta = [m for m in backfill[0]["metadata"] if m["key"] == "orbita-id"]
        self.assertEqual(len(orbita_meta), 1)
        self.assertEqual(orbita_meta[0]["value"], backfill[0]["id"])

    def test_identity_backfill_empty_for_orbita_id(self):
        oid = new_orbita_id()
        items_dict = [_txn(item_id=oid)]
        parsed, diags = validate_ledger_items(items_dict)
        self.assertEqual(diags, [])
        self.assertEqual(collect_identity_backfill(parsed), [])

    def test_validate_returns_identity_backfill(self):
        assert_safe_ledger_test_root()
        target = get_write_target()
        bill = Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])
        (bill / "account.bean").write_text(
            'option "operating_currency" "CNY"\n'
            '2026-01-01 open Assets:Cash CNY\n'
            '2026-01-01 open Expenses:Food CNY\n',
            encoding="utf-8",
        )
        (bill / "category.bean").write_text("", encoding="utf-8")
        (bill / "ledger").mkdir(parents=True, exist_ok=True)
        (bill / target).write_text("", encoding="utf-8")
        (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
        (bill / ".bkeasy/settings.json").write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        txn = _txn(item_id="ledger/2026.bean:12")
        ok, diags, token, candidate_hash, backfill = validate_candidate_items([txn])
        self.assertTrue(ok, diags)
        self.assertEqual(len(backfill), 1)
        self.assertEqual(backfill[0]["from_id"], "ledger/2026.bean:12")
        from ledger.services.candidate_commit import commit_validated_items
        from ledger.services.candidate import hash_candidate
        from ledger.services.ledger_item_validate import validate_ledger_items
        from ledger.services.ledger_render import render_ledger_file
        from ledger.services.ledger_item import active_items

        parsed, model_diags = validate_ledger_items(active_items([txn]))
        self.assertEqual(model_diags, [])
        text = render_ledger_file(parsed, assign_ids=True)
        self.assertEqual(hash_candidate(text), candidate_hash)
        commit_validated_items([txn], token, candidate_hash)

    def test_filter_deleted_before_validate(self):
        assert_safe_ledger_test_root()
        target = get_write_target()
        bill = Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])
        (bill / "account.bean").write_text('option "operating_currency" "CNY"\n', encoding="utf-8")
        (bill / "category.bean").write_text("", encoding="utf-8")
        (bill / "ledger").mkdir(parents=True, exist_ok=True)
        (bill / target).write_text("", encoding="utf-8")
        (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
        (bill / ".bkeasy/settings.json").write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        txn = _txn(item_id=new_orbita_id())
        ok, diags, token, _, backfill = validate_candidate_items([{**txn, "_deleted": True}])
        self.assertFalse(ok)
        self.assertTrue(any("为空" in d["message"] for d in diags))
        self.assertIsNone(token)
        self.assertEqual(backfill, [])

if __name__ == "__main__":
    raise SystemExit(unittest.main())

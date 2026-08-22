import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import LedgerBillIsolationMixin

from ledger.services.candidate import hash_candidate, issue_token
from ledger.services.candidate_commit import commit_validated_items
from ledger.services.candidate_validate import validate_candidate_items
from ledger.services.ledger_item import Transaction, item_to_dict, new_orbita_id
from ledger.services.ledger_item_validate import validate_ledger_items
from ledger.services.ledger_render import render_ledger_candidate, render_ledger_file
from ledger.services.parser import parse_file, invalidate_parse_cache
from ledger.services.settings import get_write_target

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def _bill_root() -> Path:
    return Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])


def _setup_bill(*, ledger_content: str = "", extra_accounts: str = "") -> Path:
    bill = _bill_root()
    target = get_write_target()
    accounts = (
        'option "operating_currency" "CNY"\n'
        "2026-01-01 open Assets:Cash CNY\n"
        "2026-01-01 open Assets:Card:Octopus HKD\n"
        "2026-01-01 open Assets:Receivable:Family CNY\n"
        "2026-01-01 open Expenses:Food CNY\n"
        + extra_accounts
    )
    (bill / "account.bean").write_text(accounts, encoding="utf-8")
    (bill / "category.bean").write_text("", encoding="utf-8")
    (bill / "ledger").mkdir(parents=True, exist_ok=True)
    ledger_path = bill / target
    ledger_path.write_text(ledger_content, encoding="utf-8")
    (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
    (bill / ".bkeasy/settings.json").write_text(
        '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
        encoding="utf-8",
    )
    invalidate_parse_cache()
    return ledger_path


def _txn(
    *,
    item_id: str = "",
    payee: str = "测试",
    postings: list[dict] | None = None,
) -> dict:
    target = get_write_target()
    return {
        "kind": "transaction",
        "id": item_id or new_orbita_id(),
        "source_file": target,
        "source_line": 1,
        "type": "expense",
        "date": "2026-03-01",
        "flag": "*",
        "payee": payee,
        "remark": "",
        "tags": "",
        "postings": postings
        or [
            {"account": "Expenses:Food", "amount": 10.0, "currency": "CNY"},
            {"account": "Assets:Cash", "amount": -10.0, "currency": "CNY"},
        ],
        "seq": "a0",
    }


class CandidateDataCorrectnessTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_parse_empty_posting_preserved(self):
        bean = (
            '2026-03-01 * "八达通" "充值"\n'
            "    Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
            "    Assets:Receivable:Family\n"
        )
        ledger_path = _setup_bill(ledger_content=bean)
        result = parse_file(ledger_path, get_write_target())
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertEqual(len(txn.postings), 2)
        self.assertEqual(txn.postings[0].amount, "-332.00")
        self.assertIsNone(txn.postings[1].amount)

    def test_render_round_trip_preserves_empty_posting(self):
        bean = (
            '2026-03-01 * "八达通" "充值"\n'
            "    Assets:Card:Octopus           -332.00 HKD @@ 290.00 CNY\n"
            "    Assets:Receivable:Family\n"
        )
        ledger_path = _setup_bill(ledger_content=bean)
        first = parse_file(ledger_path, get_write_target())
        text = render_ledger_file(first.items, assign_ids=True)
        self.assertIn("Assets:Receivable:Family\n", text)
        self.assertNotIn("332.00 HKD", text.split("Assets:Receivable:Family")[1].split("\n")[0])

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".bean", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(text)
            tmp_path = Path(tmp.name)
        try:
            second = parse_file(tmp_path, get_write_target())
        finally:
            tmp_path.unlink(missing_ok=True)
        self.assertIsNone(second.items[0].postings[1].amount)

    def test_edit_unrelated_field_keeps_empty_posting(self):
        _setup_bill()
        txn = _txn(
            postings=[
                {
                    "account": "Assets:Card:Octopus",
                    "amount": -332.0,
                    "currency": "HKD",
                    "cost_amount": 290.0,
                    "cost_currency": "CNY",
                },
                {"account": "Assets:Receivable:Family", "amount": None, "currency": ""},
            ],
        )
        txn["remark"] = "已改标题"
        parsed, diags = validate_ledger_items([txn])
        self.assertEqual(diags, [])
        text = render_ledger_file(parsed, assign_ids=False)
        self.assertIn('已改标题', text)
        self.assertIn("Assets:Receivable:Family\n", text)

    def test_validate_passes_for_empty_posting_with_cost(self):
        _setup_bill()
        txn = _txn(
            postings=[
                {
                    "account": "Assets:Card:Octopus",
                    "amount": -332.0,
                    "currency": "HKD",
                    "cost_amount": 290.0,
                    "cost_currency": "CNY",
                },
                {"account": "Assets:Receivable:Family", "amount": None, "currency": ""},
            ],
        )
        ok, diags, token, candidate_hash, _ = validate_candidate_items([txn])
        self.assertTrue(ok, diags)
        self.assertIsNotNone(token)
        self.assertIsNotNone(candidate_hash)

    def test_unbalanced_transaction_maps_to_item_id(self):
        _setup_bill()
        bad_id = new_orbita_id()
        good_id = new_orbita_id()
        items = [
            _txn(item_id=good_id, payee="正常"),
            _txn(
                item_id=bad_id,
                payee="不平衡",
                postings=[
                    {"account": "Expenses:Food", "amount": 10.0, "currency": "CNY"},
                    {"account": "Assets:Cash", "amount": -9.0, "currency": "CNY"},
                ],
            ),
        ]
        ok, diags, token, _, _ = validate_candidate_items(items)
        self.assertFalse(ok)
        self.assertIsNone(token)
        mapped = [d for d in diags if bad_id in d.get("item_ids", [])]
        self.assertTrue(mapped, diags)

    def test_global_when_line_outside_ranges(self):
        from ledger.services.candidate import _map_error_to_item_ids
        from ledger.services.ledger_render import CandidateItemRange

        class FakeErr:
            message = "syntax error"
            source = {"filename": "ledger/2026.bean", "lineno": 999}

        ranges = [CandidateItemRange("txn_1", 1, 5)]
        ids = _map_error_to_item_ids(FakeErr(), _bill_root() / get_write_target(), ranges)
        self.assertEqual(ids, [])

    def test_mapped_when_line_inside_range(self):
        from ledger.services.candidate import _map_error_to_item_ids
        from ledger.services.ledger_render import CandidateItemRange

        class FakeErr:
            message = "balance failed"
            source = {"filename": "ledger/2026.bean", "lineno": 3}

        ranges = [CandidateItemRange("txn_bad", 1, 5)]
        ids = _map_error_to_item_ids(FakeErr(), _bill_root() / get_write_target(), ranges)
        self.assertEqual(ids, ["txn_bad"])

    def test_multi_source_maps_multiple_item_ids(self):
        from ledger.services.candidate import _map_error_to_item_ids
        from ledger.services.ledger_render import CandidateItemRange

        class PostingMeta:
            meta = {"filename": "ledger/2026.bean", "lineno": 8}

        class FakeEntry:
            meta = {"filename": "ledger/2026.bean", "lineno": 3}
            postings = [PostingMeta()]

        class FakeErr:
            message = "multi"
            source = {"filename": "ledger/2026.bean", "lineno": 3}
            entry = FakeEntry()

        ranges = [
            CandidateItemRange("txn_a", 1, 5),
            CandidateItemRange("txn_b", 6, 10),
        ]
        ids = _map_error_to_item_ids(FakeErr(), _bill_root() / get_write_target(), ranges)
        self.assertEqual(ids, ["txn_a", "txn_b"])

    def test_two_unbalanced_transactions_each_mapped(self):
        _setup_bill()
        bad_a = new_orbita_id()
        bad_b = new_orbita_id()
        items = [
            _txn(
                item_id=bad_a,
                payee="坏A",
                postings=[
                    {"account": "Expenses:Food", "amount": 10.0, "currency": "CNY"},
                    {"account": "Assets:Cash", "amount": -9.0, "currency": "CNY"},
                ],
            ),
            _txn(
                item_id=bad_b,
                payee="坏B",
                postings=[
                    {"account": "Expenses:Food", "amount": 20.0, "currency": "CNY"},
                    {"account": "Assets:Cash", "amount": -19.0, "currency": "CNY"},
                ],
            ),
        ]
        ok, diags, token, _, _ = validate_candidate_items(items)
        self.assertFalse(ok)
        self.assertIsNone(token)
        mapped_ids = {iid for d in diags for iid in d.get("item_ids", [])}
        self.assertIn(bad_a, mapped_ids)
        self.assertIn(bad_b, mapped_ids)

    def _commit_items(self, items: list[dict]) -> None:
        ok, diags, token, candidate_hash, _ = validate_candidate_items(items)
        self.assertTrue(ok, diags)
        commit_validated_items(items, token, candidate_hash)

    def test_metadata_time_e2e_atomic_commit_reload(self):
        fixture = (FIXTURES_DIR / "whitelist_metadata.bean").read_text(encoding="utf-8")
        ledger_path = _setup_bill(ledger_content=fixture)
        target = get_write_target()
        before = parse_file(ledger_path, target)
        self.assertEqual(before.diagnostics, [])
        txn = before.items[0]
        self.assertIsInstance(txn, Transaction)
        time_meta = next(m for m in txn.metadata if m.key == "time")
        self.assertEqual(time_meta.value, "2026-05-19T14:32:00+08:00")
        custom_meta = next(m for m in txn.metadata if m.key == "custom-note")
        self.assertEqual(custom_meta.value, "保留")

        items = [item_to_dict(txn)]
        items[0]["remark"] = "edited-带时间"
        self._commit_items(items)
        invalidate_parse_cache()
        after = parse_file(ledger_path, target)
        self.assertEqual(after.diagnostics, [])
        reloaded = after.items[0]
        self.assertEqual(reloaded.remark, "edited-带时间")
        self.assertEqual(
            next(m for m in reloaded.metadata if m.key == "time").value,
            "2026-05-19T14:32:00+08:00",
        )
        self.assertEqual(
            next(m for m in reloaded.metadata if m.key == "custom-note").value,
            "保留",
        )

    def test_new_txn_time_metadata_commit_reload(self):
        _setup_bill()
        txn = _txn()
        txn["metadata"] = [
            {"key": "bkeasy-type", "value": "expense"},
            {"key": "time", "value": "2026-03-01T08:05:00+08:00"},
        ]
        self._commit_items([txn])
        invalidate_parse_cache()
        after = parse_file(_bill_root() / get_write_target(), get_write_target())
        self.assertEqual(after.diagnostics, [])
        reloaded = after.items[0]
        self.assertEqual(
            next(m for m in reloaded.metadata if m.key == "time").value,
            "2026-03-01T08:05:00+08:00",
        )
        self.assertEqual(
            next(m for m in reloaded.metadata if m.key == "bkeasy-type").value,
            "expense",
        )

    def test_commit_failure_preserves_candidate_token(self):
        _setup_bill()
        txn = _txn()
        parsed, _ = validate_ledger_items([txn])
        text, _ = render_ledger_candidate(parsed, assign_ids=True)
        candidate_hash = hash_candidate(text)
        token = issue_token(candidate_hash)
        with patch("ledger.services.candidate_commit.atomic_write", side_effect=OSError("fail")):
            with self.assertRaises(OSError):
                commit_validated_items([txn], token, candidate_hash)
        from ledger.services.candidate import verify_token

        self.assertTrue(verify_token(token, candidate_hash))

    def test_cost_annotations_e2e_commit_reload(self):
        fixture = (FIXTURES_DIR / "whitelist_cost_annotations.bean").read_text(encoding="utf-8")
        bill = _bill_root()
        target = get_write_target()
        accounts = (
            'option "operating_currency" "CNY"\n'
            "2026-01-01 open Assets:Cash CNY, USD, EUR\n"
            "2026-01-01 open Assets:Card:Octopus HKD\n"
            "2026-01-01 open Assets:Receivable:Family\n"
            "2026-01-01 open Expenses:Food CNY, USD\n"
        )
        (bill / "account.bean").write_text(accounts, encoding="utf-8")
        (bill / "category.bean").write_text("", encoding="utf-8")
        (bill / "ledger").mkdir(parents=True, exist_ok=True)
        ledger_path = bill / target
        ledger_path.write_text(fixture, encoding="utf-8")
        (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
        (bill / ".bkeasy/settings.json").write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        invalidate_parse_cache()
        before = parse_file(ledger_path, target)
        self.assertEqual(before.diagnostics, [])
        items = [item_to_dict(i) for i in before.items if isinstance(i, Transaction)]
        for item in items:
            item["remark"] = f"edited-{item['remark']}"
        ok, diags, token, candidate_hash, _ = validate_candidate_items(items)
        self.assertTrue(ok, diags)
        commit_validated_items(items, token, candidate_hash)
        invalidate_parse_cache()
        after = parse_file(ledger_path, target)
        self.assertEqual(after.diagnostics, [])
        self.assertEqual(len(after.items), 3)
        octopus = next(
            i for i in after.items if isinstance(i, Transaction) and i.payee == "八达通"
        )
        self.assertIsNone(octopus.postings[1].amount)
        self.assertEqual(octopus.postings[0].cost_amount, "290.00")
        at_txn = next(i for i in after.items if isinstance(i, Transaction) and i.payee == "外汇")
        self.assertEqual(at_txn.postings[1].price_amount, "7.00")
        lot_txn = next(i for i in after.items if isinstance(i, Transaction) and i.payee == "批次")
        self.assertEqual(lot_txn.postings[1].lot_amount, "8.50")
        self.assertEqual(lot_txn.postings[1].lot_date, "2026-01-15")


if __name__ == "__main__":
    raise SystemExit(unittest.main())

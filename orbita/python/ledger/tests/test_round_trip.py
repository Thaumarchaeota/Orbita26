import os
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import LedgerBillIsolationMixin

from ledger.services.ledger_item import (
    Balance,
    LedgerItem,
    Pad,
    Transaction,
    is_valid_orbita_id,
)
from ledger.services.ledger_render import render_ledger_file
from ledger.services.parser import parse_file

SOURCE_FILE = "ledger/fixture.bean"


def _posting_snapshot(posting) -> dict:
    return {
        "account": posting.account,
        "amount": posting.amount,
        "currency": posting.currency,
        "price_amount": posting.price_amount,
        "price_currency": posting.price_currency,
        "cost_amount": posting.cost_amount,
        "cost_currency": posting.cost_currency,
        "lot_amount": posting.lot_amount,
        "lot_currency": posting.lot_currency,
        "lot_date": posting.lot_date,
    }


def semantic_snapshot(items: list[LedgerItem]) -> list[dict]:
    out: list[dict] = []
    for item in sorted(
        items,
        key=lambda x: (
            x.date,
            getattr(x, "payee", ""),
            getattr(x, "account", ""),
            getattr(x, "source_line", 0),
        ),
    ):
        if isinstance(item, Transaction):
            meta = sorted(
                (m.key, m.value)
                for m in item.metadata
                if m.key not in ("bkeasy-type", "orbita-id")
            )
            out.append(
                {
                    "kind": "transaction",
                    "date": item.date,
                    "flag": item.flag,
                    "payee": item.payee,
                    "remark": item.remark,
                    "tags": sorted(item.tags),
                    "type": item.type,
                    "orbita_id": item.id if is_valid_orbita_id(item.id) else "",
                    "postings": [_posting_snapshot(p) for p in item.postings],
                    "metadata": meta,
                }
            )
        elif isinstance(item, Pad):
            out.append(
                {
                    "kind": "pad",
                    "date": item.date,
                    "account": item.account,
                    "source_account": item.source_account,
                }
            )
        elif isinstance(item, Balance):
            out.append(
                {
                    "kind": "balance",
                    "date": item.date,
                    "account": item.account,
                    "amount": item.amount,
                    "currency": item.currency,
                }
            )
    return out


def round_trip_parse(path: Path) -> tuple[list[LedgerItem], list[LedgerItem]]:
    first = parse_file(path, SOURCE_FILE)
    rendered = render_ledger_file(first.items, assign_ids=True)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".bean", delete=False, encoding="utf-8"
    ) as tmp:
        tmp.write(rendered)
        tmp_path = Path(tmp.name)
    try:
        second = parse_file(tmp_path, SOURCE_FILE)
    finally:
        tmp_path.unlink(missing_ok=True)
    return first.items, second.items


class RoundTripTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_transactions_semantic_round_trip(self):
        first, second = round_trip_parse(FIXTURES_DIR / "whitelist_transactions.bean")
        self.assertEqual(semantic_snapshot(first), semantic_snapshot(second))

    def test_pad_balance_semantic_round_trip(self):
        first, second = round_trip_parse(FIXTURES_DIR / "whitelist_pad_balance.bean")
        self.assertEqual(semantic_snapshot(first), semantic_snapshot(second))

    def test_cost_annotations_semantic_round_trip(self):
        first, second = round_trip_parse(FIXTURES_DIR / "whitelist_cost_annotations.bean")
        self.assertEqual(semantic_snapshot(first), semantic_snapshot(second))

    def test_round_trip_has_no_diagnostics(self):
        path = FIXTURES_DIR / "whitelist_transactions.bean"
        first = parse_file(path, SOURCE_FILE)
        self.assertEqual(first.diagnostics, [])
        rendered = render_ledger_file(first.items, assign_ids=True)
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".bean", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(rendered)
            tmp_path = Path(tmp.name)
        try:
            second = parse_file(tmp_path, SOURCE_FILE)
        finally:
            tmp_path.unlink(missing_ok=True)
        self.assertEqual(second.diagnostics, [])

    def test_round_trip_preserves_unknown_duplicate_metadata_and_escaped_strings(self):
        source = (
            '2026-03-01 * "payee with \\"quote\\"" "line\\nremark\\\\slash" #food\n'
            "    Expenses:Food                   10.00 CNY\n"
            "    Assets:Cash                    -10.00 CNY\n"
            '  custom-note: "first \\"quote\\""\n'
            '  custom-note: "second\\nline"\n'
        )
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".bean", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(source)
            source_path = Path(tmp.name)
        try:
            first, second = round_trip_parse(source_path)
        finally:
            source_path.unlink(missing_ok=True)
        self.assertEqual(semantic_snapshot(first), semantic_snapshot(second))
        txn = second[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(
            [(m.key, m.value) for m in txn.metadata if m.key == "custom-note"],
            [("custom-note", 'first "quote"'), ("custom-note", "second\nline")],
        )


class UnsupportedDirectiveTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def _parse(self, name: str):
        return parse_file(FIXTURES_DIR / name, SOURCE_FILE)

    def test_blocks_open_directive(self):
        result = self._parse("unsupported_open.bean")
        self.assertEqual(result.items, [])
        self.assertEqual(len(result.diagnostics), 1)
        self.assertIn("open", result.diagnostics[0].message)

    def test_blocks_include_directive(self):
        result = self._parse("unsupported_include.bean")
        self.assertEqual(result.items, [])
        self.assertTrue(any("include" in d.message for d in result.diagnostics))

    def test_blocks_posting_flag(self):
        result = self._parse("unsupported_posting_flag.bean")
        self.assertTrue(any("posting flag" in d.message for d in result.diagnostics))
        self.assertEqual(len(result.items), 1)
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(len(txn.postings), 1)
        self.assertEqual(txn.postings[0].account, "Expenses:Food")

    def test_parses_single_at_price(self):
        result = self._parse("unsupported_at_cost.bean")
        self.assertEqual(result.diagnostics, [])
        txn = result.items[0]
        self.assertIsInstance(txn, Transaction)
        self.assertEqual(len(txn.postings), 2)
        self.assertEqual(txn.postings[0].price_amount, "70.00")
        self.assertEqual(txn.postings[0].price_currency, "CNY")

    def test_mixed_file_keeps_supported_items_and_blocks_unsupported(self):
        result = self._parse("unsupported_mixed.bean")
        self.assertEqual(len(result.items), 1)
        self.assertIsInstance(result.items[0], Transaction)
        self.assertEqual(result.items[0].payee, "午餐")
        self.assertEqual(len(result.diagnostics), 1)
        self.assertIn("open", result.diagnostics[0].message)


if __name__ == "__main__":
    raise SystemExit(unittest.main())

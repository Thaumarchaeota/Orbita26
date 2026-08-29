import os
import sys
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))

from ledger.tests.bill_isolation import (
    assert_safe_ledger_test_root,
    LedgerBillIsolationMixin,
)

from unittest.mock import patch

from ledger.services.candidate import hash_candidate, issue_token, verify_token
from ledger.services.candidate_commit import commit_validated_items
from ledger.services.candidate_validate import validate_candidate_items
from ledger.services.ledger_item_validate import validate_ledger_items
from ledger.services.ledger_render import render_ledger_file
from ledger.services.parser import invalidate_parse_cache
from ledger.services.settings import get_write_target


def _bill_root() -> Path:
    return Path(os.environ["ORBITA_LEDGER_DATA_ROOT"])


def _setup_bill(*, ledger_content: str = "") -> Path:
    assert_safe_ledger_test_root()
    bill = _bill_root()
    (bill / ".bkeasy").mkdir(parents=True, exist_ok=True)
    (bill / ".bkeasy/settings.json").write_text(
        '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
        encoding="utf-8",
    )
    target = get_write_target()
    (bill / "account.bean").write_text(
        'option "operating_currency" "CNY"\n'
        "2026-01-01 open Assets:Cash CNY\n"
        "2026-01-01 open Expenses:Food CNY\n",
        encoding="utf-8",
    )
    (bill / "category.bean").write_text("", encoding="utf-8")
    (bill / "ledger").mkdir(parents=True, exist_ok=True)
    ledger_path = bill / target
    ledger_path.write_text(ledger_content, encoding="utf-8")
    invalidate_parse_cache()
    return ledger_path


def _txn(*, item_id: str = "", date: str = "2026-03-01", seq: str = "a0") -> dict:
    target = get_write_target()
    return {
        "kind": "transaction",
        "id": item_id or "ledger/2026.bean:12",
        "source_file": target,
        "source_line": 1,
        "type": "expense",
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


class CandidateSafetyTests(LedgerBillIsolationMixin, unittest.TestCase):
    def setUp(self):
        self.setUp_bill_isolation()

    def tearDown(self):
        self.tearDown_bill_isolation()

    def test_validate_blocked_by_unsupported_on_disk(self):
        _setup_bill(ledger_content="2026-01-01 open Assets:Cash CNY\n")
        ok, diags, token, candidate_hash, backfill = validate_candidate_items([_txn()])
        self.assertFalse(ok)
        self.assertTrue(any("open" in d["message"] for d in diags))
        self.assertIsNone(token)
        self.assertIsNone(candidate_hash)
        self.assertEqual(backfill, [])

    def test_commit_blocked_by_unsupported_on_disk_file_unchanged(self):
        ledger_path = _setup_bill(
            ledger_content=(
                "2026-01-01 open Assets:Cash CNY\n"
                '2026-03-01 * "午餐" ""\n'
                "    Expenses:Food                   20.00 CNY\n"
                "    Assets:Cash                    -20.00 CNY\n"
            )
        )
        original = ledger_path.read_text(encoding="utf-8")
        txn = _txn()
        parsed, model_diags = validate_ledger_items([txn])
        self.assertEqual(model_diags, [])
        text = render_ledger_file(parsed, assign_ids=True)
        token = issue_token(hash_candidate(text))
        with self.assertRaises(ValueError) as ctx:
            commit_validated_items([txn], token, hash_candidate(text))
        self.assertIn("open", str(ctx.exception))
        self.assertEqual(ledger_path.read_text(encoding="utf-8"), original)

    def test_validate_empty_working_copy(self):
        _setup_bill()
        ok, diags, token, _, backfill = validate_candidate_items([])
        self.assertFalse(ok)
        self.assertTrue(any("为空" in d["message"] for d in diags))
        self.assertIsNone(token)
        self.assertEqual(backfill, [])

    def test_validate_model_error(self):
        _setup_bill()
        bad = {**_txn(), "type": "inv"}
        ok, diags, token, _, backfill = validate_candidate_items([bad])
        self.assertFalse(ok)
        self.assertTrue(any("inv" in d["message"] for d in diags))
        self.assertIsNone(token)
        self.assertEqual(backfill, [])

    def test_commit_output_date_asc_seq_asc(self):
        items = [
            {**_txn(item_id="ledger/2026.bean:3", date="2026-03-02", seq="a0"), "payee": "三月二日"},
            {**_txn(item_id="ledger/2026.bean:1", date="2026-03-01", seq="a1"), "payee": "三月一日第二"},
            {**_txn(item_id="ledger/2026.bean:2", date="2026-03-01", seq="a0"), "payee": "三月一日第一"},
        ]
        parsed, diags = validate_ledger_items(items)
        self.assertEqual(diags, [])
        text = render_ledger_file(parsed, assign_ids=False)
        self.assertLess(text.index("三月一日第一"), text.index("三月一日第二"))
        self.assertLess(text.index("三月一日第二"), text.index("三月二日"))

    def test_commit_retry_after_atomic_write_failure(self):
        _setup_bill()
        txn = _txn()
        parsed, model_diags = validate_ledger_items([txn])
        self.assertEqual(model_diags, [])
        text = render_ledger_file(parsed, assign_ids=True)
        candidate_hash = hash_candidate(text)
        token = issue_token(candidate_hash)
        calls = {"n": 0}

        def flaky_write(path, content):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("simulated atomic write failure")

        with patch("ledger.services.candidate_commit.atomic_write", side_effect=flaky_write):
            with self.assertRaises(OSError):
                commit_validated_items([txn], token, candidate_hash)

        self.assertTrue(verify_token(token, candidate_hash))
        with patch("ledger.services.candidate_commit.atomic_write"):
            commit_validated_items([txn], token, candidate_hash)
        self.assertFalse(verify_token(token, candidate_hash))

    def test_concurrent_commit_rejected(self):
        _setup_bill()
        txn = _txn()
        parsed, model_diags = validate_ledger_items([txn])
        self.assertEqual(model_diags, [])
        text = render_ledger_file(parsed, assign_ids=True)
        candidate_hash = hash_candidate(text)
        token = issue_token(candidate_hash)

        from ledger.services.candidate import release_token, reserve_token

        self.assertTrue(reserve_token(token, candidate_hash))
        with self.assertRaises(ValueError) as ctx:
            commit_validated_items([txn], token, candidate_hash)
        self.assertIn("验证已失效", str(ctx.exception))
        release_token(token)

        with patch("ledger.services.candidate_commit.atomic_write"):
            commit_validated_items([txn], token, candidate_hash)
        self.assertFalse(verify_token(token, candidate_hash))

    def test_reserved_token_completes_after_ttl_boundary(self):
        from ledger.services import candidate

        token = issue_token("candidate-hash")
        self.assertTrue(candidate.reserve_token(token, "candidate-hash"))
        # A commit that has already reserved its token may finish after the TTL;
        # it must not claim failure after its atomic write has succeeded.
        candidate._tokens[token].created_at -= candidate.TOKEN_TTL_SEC + 1
        self.assertTrue(candidate.finalize_token(token, "candidate-hash"))
        self.assertFalse(verify_token(token, "candidate-hash"))

    def test_commit_rejects_version_drift_in_all_candidate_inputs(self):
        ledger_path = _setup_bill()
        target = get_write_target()
        txn = _txn()
        with patch("ledger.services.candidate_validate.beancount_check_in_temp", return_value=[]):
            ok, diags, token, candidate_hash, _ = validate_candidate_items([txn])
        self.assertTrue(ok, diags)

        mutations = {
            "write-target": (ledger_path, '2026-03-02 * "external" ""\n    Expenses:Food 1.00 CNY\n    Assets:Cash -1.00 CNY\n'),
            "account": (_bill_root() / "account.bean", "\n; external account revision\n"),
            "category": (_bill_root() / "category.bean", "\n; external category revision\n"),
            # The setting selects the physical write target and is part of the
            # fingerprint even when neither ledger file changed.
            "settings-write-target": (
                _bill_root() / ".bkeasy/settings.json",
                '{"write_target":"ledger/other.bean","reporting_currency":"CNY"}',
            ),
        }
        for name, (path, addition) in mutations.items():
            with self.subTest(name=name):
                if name == "settings-write-target":
                    path.write_text(addition, encoding="utf-8")
                else:
                    path.write_text(path.read_text(encoding="utf-8") + addition, encoding="utf-8")
                external = path.read_text(encoding="utf-8")
                with self.assertRaises(ValueError) as ctx:
                    commit_validated_items([txn], token, candidate_hash)
                if name != "settings-write-target":
                    self.assertIn("磁盘内容已变更", str(ctx.exception))
                self.assertEqual(path.read_text(encoding="utf-8"), external)
                if name == "settings-write-target":
                    # The safety gate rejects the now-stale item source before
                    # commit reaches the fingerprint comparison; either way it
                    # must not write the newly selected target.
                    self.assertFalse((_bill_root() / "ledger/other.bean").exists())
                    continue
                # Revalidate for the next independent drift source.
                with patch("ledger.services.candidate_validate.beancount_check_in_temp", return_value=[]):
                    ok, diags, token, candidate_hash, _ = validate_candidate_items([txn])
                self.assertTrue(ok, diags)

    def test_commit_fingerprint_rejects_write_target_setting_drift(self):
        ledger_path = _setup_bill()
        txn = _txn()
        with patch("ledger.services.candidate_validate.beancount_check_in_temp", return_value=[]):
            ok, diags, token, candidate_hash, _ = validate_candidate_items([txn])
        self.assertTrue(ok, diags)

        settings_path = _bill_root() / ".bkeasy/settings.json"
        settings_path.write_text(
            '{"write_target":"ledger/other.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        # Keep the candidate text unchanged while satisfying the model's
        # current-target source rule; this reaches the later fingerprint gate.
        txn["source_file"] = "ledger/other.bean"
        original_ledger = ledger_path.read_bytes()
        # Skip the earlier source-file safety diagnostic so this regression
        # reaches the commit-critical fingerprint guard itself.
        with patch("ledger.services.candidate_commit.on_disk_safety_diagnostics", return_value=[]):
            with self.assertRaises(ValueError) as ctx:
                commit_validated_items([txn], token, candidate_hash)
        self.assertIn("磁盘内容已变更", str(ctx.exception))
        self.assertEqual(ledger_path.read_bytes(), original_ledger)
        self.assertFalse((_bill_root() / "ledger/other.bean").exists())

    def test_validate_commit_preserves_pad_and_balance(self):
        _setup_bill()
        target = get_write_target()
        pad = {
            "kind": "pad",
            "id": "ledger/2026.bean:1",
            "source_file": target,
            "source_line": 1,
            "date": "2026-03-01",
            "account": "Assets:Cash",
            "source_account": "Equity:Opening-Balances",
            "seq": "a0",
        }
        balance = {
            "kind": "balance",
            "id": "ledger/2026.bean:2",
            "source_file": target,
            "source_line": 2,
            "date": "2026-03-01",
            "account": "Assets:Cash",
            "amount": "100.00",
            "currency": "CNY",
            "seq": "a1",
        }
        txn = _txn(seq="a2")
        txn["payee"] = "晚餐"
        items = [pad, balance, txn]
        with patch("ledger.services.candidate_validate.beancount_check_in_temp", return_value=[]):
            ok, diags, token, candidate_hash, _ = validate_candidate_items(items)
        self.assertTrue(ok, diags)
        self.assertIsNotNone(token)
        with patch("ledger.services.candidate_commit.atomic_write") as write_mock:
            commit_validated_items(items, token, candidate_hash)
            written = write_mock.call_args[0][1]
        self.assertIn("pad Assets:Cash", written)
        self.assertIn("balance Assets:Cash", written)
        self.assertIn("晚餐", written)


if __name__ == "__main__":
    raise SystemExit(unittest.main())

import importlib
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))
_TEST_ROOT = Path(tempfile.mkdtemp(prefix="orbita-ledger-account-ops-"))


def _activate_test_root() -> None:
    os.environ["ORBITA_LEDGER_DATA_ROOT"] = str(_TEST_ROOT)
    import ledger.config as cfg

    importlib.reload(cfg)
    for mod_name in (
        "ledger.services.account_common",
        "ledger.services.accounts",
        "ledger.services.account_delete_scan",
        "ledger.services.account_delete",
        "ledger.services.account_create",
        "ledger.services.account_migrate",
        "ledger.services.account_label_commit",
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


class AccountOpsTestCase(unittest.TestCase):
    def setUp(self):
        _activate_test_root()
        from ledger.services.account_create import create_account
        from ledger.services.account_delete import delete_account
        from ledger.services.account_migrate import (
            commit_account_migration,
            validate_account_migration,
        )
        from ledger.services.accounts import all_declared_account_names

        self.create_account = create_account
        self.delete_account = delete_account
        self.validate_account_migration = validate_account_migration
        self.commit_account_migration = commit_account_migration
        self.all_declared_account_names = all_declared_account_names
        from ledger.services.account_label_commit import commit_account_labels

        self.commit_account_labels = commit_account_labels


class AccountDeleteExecutionTests(AccountOpsTestCase):
    def test_delete_removes_open_line(self):
        _write_fixture(
            account_lines=(
                "2026-01-01 open Assets:Cash CNY ;现金\n"
                "2026-01-01 open Assets:Bank CNY ;银行\n"
            ),
        )
        result = self.delete_account("Assets:Cash")
        self.assertTrue(result["ok"])
        names = self.all_declared_account_names()
        self.assertNotIn("Assets:Cash", names)
        self.assertIn("Assets:Bank", names)

    def test_delete_rejects_referenced_account(self):
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
        with self.assertRaises(ValueError):
            self.delete_account("Assets:Cash")


class AccountCreateTests(AccountOpsTestCase):
    def test_create_appends_open_line(self):
        _write_fixture(account_lines="2026-01-01 open Assets:Cash CNY ;现金\n")
        result = self.create_account("Assets:Wallet", open_date="2026-01-01", extra="CNY", label="钱包")
        self.assertTrue(result["ok"])
        names = self.all_declared_account_names()
        self.assertIn("Assets:Wallet", names)

    def test_create_rejects_duplicate(self):
        _write_fixture(account_lines="2026-01-01 open Assets:Cash CNY ;现金\n")
        with self.assertRaises(ValueError):
            self.create_account("Assets:Cash")

    def test_create_rejects_earlier_reference(self):
        _write_fixture(
            account_lines="2026-01-01 open Assets:Bank CNY ;银行\n",
            category_lines="2026-01-01 open Expenses:Food ;餐饮\n",
            ledger_files={
                "ledger/2026.bean": (
                    '2025-12-31 * "旧账" ""\n'
                    "    Expenses:Food                    5.00 CNY\n"
                    "    Assets:Ghost                    -5.00 CNY\n"
                ),
            },
        )
        with self.assertRaises(ValueError):
            self.create_account("Assets:Ghost", open_date="2026-01-01", extra="CNY")


class AccountMigrateTests(AccountOpsTestCase):
    def setUp(self):
        super().setUp()
        # These tests exercise the controlled multi-file replacement and rollback
        # only. Beancount candidate validation remains covered by its own
        # integration tests and must be available for real migration validation.
        checker = patch("ledger.services.account_migrate.beancount_check_migration", return_value=[])
        checker.start()
        self.addCleanup(checker.stop)

    def test_validate_and_commit_rename(self):
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
                    "    Assets:Cash                    -20.00 CNY\n"
                ),
            },
        )
        validated = self.validate_account_migration("Assets:Cash", "Assets:Wallet")
        self.assertTrue(validated["ok"], validated)
        committed = self.commit_account_migration(
            "Assets:Cash",
            "Assets:Wallet",
            validation_token=validated["validation_token"],
            candidate_hash=validated["candidate_hash"],
        )
        self.assertTrue(committed["ok"])
        names = self.all_declared_account_names()
        self.assertIn("Assets:Wallet", names)
        self.assertNotIn("Assets:Cash", names)
        ledger = (__import__("ledger.config", fromlist=["DATA_DIR"]).DATA_DIR / "ledger/2026.bean").read_text(encoding="utf-8")
        self.assertIn("Assets:Wallet", ledger)
        self.assertNotIn("Assets:Cash", ledger)

    def test_commit_leaves_disk_unchanged_when_temp_prep_fails(self):
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
                    "    Assets:Cash                    -20.00 CNY\n"
                ),
            },
        )
        from ledger.config import DATA_DIR

        validated = self.validate_account_migration("Assets:Cash", "Assets:Wallet")
        self.assertTrue(validated["ok"], validated)

        snapshots = {
            rel: (DATA_DIR / rel).read_text(encoding="utf-8")
            for rel in ("account.bean", "category.bean", "ledger/2026.bean")
        }

        original_write_text = Path.write_text
        tmp_writes = {"count": 0}

        def flaky_write_text(self, *args, **kwargs):
            if str(self).endswith(".tmp"):
                tmp_writes["count"] += 1
                if tmp_writes["count"] >= 2:
                    raise OSError("temp write failed")
            return original_write_text(self, *args, **kwargs)

        with patch.object(Path, "write_text", flaky_write_text):
            with self.assertRaises(OSError):
                self.commit_account_migration(
                    "Assets:Cash",
                    "Assets:Wallet",
                    validation_token=validated["validation_token"],
                    candidate_hash=validated["candidate_hash"],
                )

        for rel, before in snapshots.items():
            after = (DATA_DIR / rel).read_text(encoding="utf-8")
            self.assertEqual(before, after, rel)
        self.assertFalse(list(DATA_DIR.rglob("*.tmp")))
        names = self.all_declared_account_names()
        self.assertIn("Assets:Cash", names)
        self.assertNotIn("Assets:Wallet", names)

    def test_commit_restores_all_files_when_a_replace_fails(self):
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
                    "    Assets:Cash                    -20.00 CNY\n"
                ),
            },
        )
        from ledger.config import DATA_DIR

        validated = self.validate_account_migration("Assets:Cash", "Assets:Wallet")
        self.assertTrue(validated["ok"], validated)
        snapshots = {
            rel: (DATA_DIR / rel).read_bytes()
            for rel in ("account.bean", "category.bean", "ledger/2026.bean")
        }

        original_replace = Path.replace
        candidate_replaces = {"count": 0}

        def flaky_replace(self, target):
            if ".orbita-migrate-" in self.name and self.name.endswith(".tmp"):
                candidate_replaces["count"] += 1
                if candidate_replaces["count"] == 2:
                    raise OSError("candidate replace failed")
            return original_replace(self, target)

        with patch.object(Path, "replace", flaky_replace):
            with self.assertRaises(OSError):
                self.commit_account_migration(
                    "Assets:Cash",
                    "Assets:Wallet",
                    validation_token=validated["validation_token"],
                    candidate_hash=validated["candidate_hash"],
                )

        for rel, before in snapshots.items():
            self.assertEqual((DATA_DIR / rel).read_bytes(), before, rel)
        self.assertFalse(list(DATA_DIR.rglob("*.tmp")))
        self.assertFalse(list(DATA_DIR.rglob("*.bak")))


class AccountLabelTests(AccountOpsTestCase):
    def test_label_updates_open_line_comment(self):
        from ledger.config import ACCOUNT_FILE

        _write_fixture(
            account_lines=(
                "2026-01-01 open Assets:Cash CNY ;现金\n"
                "2026-01-01 open Liabilities:Card CNY ;信用卡\n"
            ),
        )
        self.commit_account_labels(
            [
                {
                    "name": "Assets:Cash",
                    "source_file": "account.bean",
                    "source_line": 1,
                    "open_date": "2026-01-01",
                    "extra": "CNY",
                    "label": "现金钱包",
                },
            ]
        )
        text = ACCOUNT_FILE.read_text(encoding="utf-8")
        self.assertIn("Assets:Cash CNY ;现金钱包", text)
        self.assertIn("Liabilities:Card CNY ;信用卡", text)

    def test_label_rejects_category_account(self):
        _write_fixture(
            account_lines="2026-01-01 open Assets:Cash CNY ;现金\n",
            category_lines="2026-01-01 open Expenses:Food ;餐饮\n",
        )
        with self.assertRaises(ValueError):
            self.commit_account_labels(
                [
                    {
                        "name": "Expenses:Food",
                        "source_file": "category.bean",
                        "source_line": 1,
                        "label": "吃饭",
                    },
                ]
            )


if __name__ == "__main__":
    raise SystemExit(unittest.main())

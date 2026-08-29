import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))


class SettingsTests(unittest.TestCase):
    mock = mock
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="orbita-ledger-settings-"))
        self.previous_root = os.environ.get("ORBITA_LEDGER_DATA_ROOT")
        os.environ["ORBITA_LEDGER_DATA_ROOT"] = str(self.root)
        from ledger.services.settings import (
            DEFAULT_CARD_STRIPES,
            get_card_stripes,
            get_reporting_currency,
            get_settings,
            save_settings,
        )

        self.DEFAULT_CARD_STRIPES = DEFAULT_CARD_STRIPES
        self.get_card_stripes = get_card_stripes
        self.get_reporting_currency = get_reporting_currency
        self.get_settings = get_settings
        self.save_settings = save_settings

    def tearDown(self):
        if self.previous_root is None:
            os.environ.pop("ORBITA_LEDGER_DATA_ROOT", None)
        else:
            os.environ["ORBITA_LEDGER_DATA_ROOT"] = self.previous_root
        shutil.rmtree(self.root, ignore_errors=True)

    def _settings_path(self) -> Path:
        return self.root / ".bkeasy" / "settings.json"

    def test_missing_reporting_currency_defaults_to_cny(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text('{"write_target":"ledger/2027.bean"}', encoding="utf-8")

        self.assertEqual(self.get_settings(), {
            "write_target": "ledger/2027.bean",
            "reporting_currency": "CNY",
            "card_stripes": self.DEFAULT_CARD_STRIPES,
            "settings_revision": 1,
            "filter_presets_schema_version": 1,
            "filter_presets_version": 1,
            "filter_presets": [],
        })

    def test_legacy_write_target_update_preserves_reporting_currency(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"USD"}',
            encoding="utf-8",
        )

        saved = self.save_settings({"write_target": "ledger/2027.bean"})

        self.assertEqual(saved, {
            "write_target": "ledger/2027.bean",
            "reporting_currency": "USD",
            "card_stripes": self.DEFAULT_CARD_STRIPES,
            "settings_revision": 2,
            "filter_presets_schema_version": 1,
            "filter_presets_version": 1,
            "filter_presets": [],
        })
        self.assertEqual(json.loads(self._settings_path().read_text(encoding="utf-8")), saved)

    def test_api_legacy_put_preserves_reporting_currency(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"EUR","settings_revision":1}',
            encoding="utf-8",
        )
        from ledger.services.settings import save_settings

        saved = save_settings({"write_target": "ledger/2027.bean"})

        self.assertEqual(saved, {
            "write_target": "ledger/2027.bean",
            "reporting_currency": "EUR",
            "card_stripes": self.DEFAULT_CARD_STRIPES,
            "settings_revision": 2,
            "filter_presets_schema_version": 1,
            "filter_presets_version": 1,
            "filter_presets": [],
        })

    def test_update_reporting_currency_keeps_write_target(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2027.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )

        saved = self.save_settings({
            "write_target": "ledger/2027.bean",
            "reporting_currency": "usd",
        })

        self.assertEqual(saved["write_target"], "ledger/2027.bean")
        self.assertEqual(saved["reporting_currency"], "USD")
        self.assertEqual(self.get_reporting_currency(), "USD")

    def test_invalid_reporting_currency_is_rejected(self):
        with self.assertRaises(ValueError):
            self.save_settings({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "USDT",
            })

    def test_card_stripes_round_trip(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        saved = self.save_settings({
            "write_target": "ledger/2026.bean",
            "reporting_currency": "CNY",
            "card_stripes": {**self.DEFAULT_CARD_STRIPES, "expense": "#FF8800"},
        })
        self.assertEqual(saved["card_stripes"]["expense"], "#FF8800")
        self.assertEqual(self.get_card_stripes()["expense"], "#FF8800")

    def test_invalid_card_stripe_color_is_rejected(self):
        with self.assertRaises(ValueError):
            self.save_settings({
                "write_target": "ledger/2026.bean",
                "card_stripes": {"expense": "orange"},
            })

    def test_stats_uses_the_settings_reporting_currency(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"EUR"}',
            encoding="utf-8",
        )
        from ledger.services.stats import _reporting_currency

        self.assertEqual(_reporting_currency(), "EUR")

    def test_filter_presets_round_trip(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        preset = {
            "id": "preset-1",
            "name": "日常",
            "date": {"mode": "relative", "preset": "last7"},
            "typeMode": "selected",
            "types": ["expense", "income"],
            "accounts": ["Assets:Cash"],
            "accountMode": "or",
            "tags": ["trip"],
            "tagMode": "and",
        }
        saved = self.save_settings({
            "write_target": "ledger/2026.bean",
            "reporting_currency": "CNY",
            "filter_presets": [preset],
        })
        self.assertEqual(saved["filter_presets"], [preset])
        self.assertEqual(self.get_settings()["filter_presets"], [preset])

    def test_legacy_put_preserves_filter_presets(self):
        preset = {
            "id": "preset-1",
            "name": "日常",
            "date": {"mode": "all"},
            "typeMode": "all",
            "types": [],
            "accounts": [],
            "accountMode": "or",
            "tags": [],
            "tagMode": "or",
        }
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            json.dumps({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "CNY",
                "filter_presets_version": 1,
                "filter_presets": [preset],
            }),
            encoding="utf-8",
        )
        saved = self.save_settings({"write_target": "ledger/2027.bean"})
        self.assertEqual(saved["write_target"], "ledger/2027.bean")
        self.assertEqual(saved["filter_presets"], [preset])
        on_disk = json.loads(self._settings_path().read_text(encoding="utf-8"))
        self.assertEqual(on_disk["filter_presets"], [preset])

    def test_save_preserves_unknown_top_level_keys(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            json.dumps({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "CNY",
                "experimental_flag": True,
                "custom_note": "keep me",
            }),
            encoding="utf-8",
        )
        saved = self.save_settings({"write_target": "ledger/2027.bean"})
        self.assertEqual(saved["write_target"], "ledger/2027.bean")
        self.assertTrue(saved["experimental_flag"])
        self.assertEqual(saved["custom_note"], "keep me")
        on_disk = json.loads(self._settings_path().read_text(encoding="utf-8"))
        self.assertTrue(on_disk["experimental_flag"])
        self.assertEqual(on_disk["custom_note"], "keep me")

    def test_invalid_absolute_filter_preset_dates_are_diagnosed(self):
        self._settings_path().parent.mkdir(parents=True)
        on_disk = {
            "write_target": "ledger/2026.bean",
            "reporting_currency": "CNY",
            "filter_presets": [
                {
                    "id": "bad-format",
                    "name": "坏格式",
                    "date": {"mode": "absolute", "from": "2026/01/01", "to": "2026-01-31"},
                    "typeMode": "all",
                    "types": [],
                    "accounts": [],
                    "accountMode": "or",
                    "tags": [],
                    "tagMode": "or",
                },
                {
                    "id": "bad-order",
                    "name": "坏顺序",
                    "date": {"mode": "absolute", "from": "2026-02-01", "to": "2026-01-01"},
                    "typeMode": "all",
                    "types": [],
                    "accounts": [],
                    "accountMode": "or",
                    "tags": [],
                    "tagMode": "or",
                },
                {
                    "id": "good",
                    "name": "可用",
                    "date": {"mode": "absolute", "from": "2026-01-01", "to": "2026-01-31"},
                    "typeMode": "all",
                    "types": [],
                    "accounts": [],
                    "accountMode": "or",
                    "tags": [],
                    "tagMode": "or",
                },
            ],
        }
        self._settings_path().write_text(json.dumps(on_disk), encoding="utf-8")

        settings = self.get_settings()
        presets = settings["filter_presets"]
        self.assertEqual(len(presets), 1)
        self.assertEqual(presets[0]["id"], "good")
        diags = settings["diagnostics"]
        self.assertEqual(len(diags), 2)
        self.assertEqual(diags[0]["preset_id"], "bad-format")
        self.assertEqual(diags[0]["path"], "filter_presets[0].date.from")
        self.assertEqual(diags[1]["preset_id"], "bad-order")
        self.assertEqual(diags[1]["path"], "filter_presets[1].date")

    def test_corrupt_filter_presets_are_diagnosed_and_preserved_on_save(self):
        self._settings_path().parent.mkdir(parents=True)
        on_disk = {
            "write_target": "ledger/2026.bean",
            "reporting_currency": "CNY",
            "filter_presets": [
                {
                    "id": "good",
                    "name": "可用",
                    "date": {"mode": "all"},
                    "typeMode": "all",
                    "types": [],
                    "accounts": [],
                    "accountMode": "or",
                    "tags": [],
                    "tagMode": "or",
                },
                {"id": "", "name": "坏"},
                "not-an-object",
            ],
        }
        self._settings_path().write_text(json.dumps(on_disk), encoding="utf-8")

        settings = self.get_settings()
        presets = settings["filter_presets"]
        self.assertEqual(len(presets), 1)
        self.assertEqual(presets[0]["id"], "good")
        diags = settings["diagnostics"]
        bad_indexes = {diag["index"] for diag in diags if "index" in diag}
        self.assertIn(1, bad_indexes)
        self.assertIn(2, bad_indexes)

        saved = self.save_settings({"write_target": "ledger/2027.bean"})
        self.assertEqual(saved["write_target"], "ledger/2027.bean")
        self.assertEqual(saved["filter_presets"], on_disk["filter_presets"])
        reloaded = json.loads(self._settings_path().read_text(encoding="utf-8"))
        self.assertEqual(reloaded["filter_presets"], on_disk["filter_presets"])

    def test_corrupt_json_bytes_unchanged_on_save(self):
        self._settings_path().parent.mkdir(parents=True)
        corrupt = '{"write_target":"ledger/2026.bean",'
        self._settings_path().write_text(corrupt, encoding="utf-8")

        settings = self.get_settings()
        self.assertEqual(settings["diagnostics"][0]["code"], "settings_json_invalid")
        with self.assertRaises(ValueError):
            self.save_settings({"write_target": "ledger/2027.bean"})
        self.assertEqual(self._settings_path().read_text(encoding="utf-8"), corrupt)

    def test_explicit_save_can_replace_corrupt_presets(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            json.dumps({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "CNY",
                "filter_presets": [{"id": "", "name": "坏"}],
            }),
            encoding="utf-8",
        )
        good_preset = {
            "id": "good",
            "name": "可用",
            "date": {"mode": "all"},
            "typeMode": "all",
            "types": [],
            "accounts": [],
            "accountMode": "or",
            "tags": [],
            "tagMode": "or",
        }
        saved = self.save_settings({"filter_presets": [good_preset]})
        self.assertEqual(saved["filter_presets"], [good_preset])

    def test_save_rejects_invalid_absolute_dates(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY"}',
            encoding="utf-8",
        )
        bad_preset = {
            "id": "bad",
            "name": "坏",
            "date": {"mode": "absolute", "from": "2026/01/01", "to": "2026-01-31"},
            "typeMode": "all",
            "types": [],
            "accounts": [],
            "accountMode": "or",
            "tags": [],
            "tagMode": "or",
        }
        with self.assertRaises(ValueError):
            self.save_settings({"filter_presets": [bad_preset]})

    def test_save_uses_atomic_write(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY","settings_revision":1}',
            encoding="utf-8",
        )
        with self.mock.patch("ledger.services.settings.atomic_write") as atomic_mock:
            self.save_settings({
                "write_target": "ledger/2026.bean",
                "expected_settings_revision": 1,
            })
        atomic_mock.assert_called_once()

    def test_save_rejects_revision_conflict(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY","settings_revision":3}',
            encoding="utf-8",
        )
        from ledger.services.settings import SettingsRevisionConflict

        with self.assertRaises(SettingsRevisionConflict):
            self.save_settings({
                "write_target": "ledger/2026.bean",
                "expected_settings_revision": 2,
            })

    def test_api_put_returns_409_on_revision_conflict(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"CNY","settings_revision":2}',
            encoding="utf-8",
        )
        from ledger.services.settings import SettingsRevisionConflict, save_settings

        with self.assertRaises(SettingsRevisionConflict) as ctx:
            save_settings({
                "write_target": "ledger/2026.bean",
                "expected_settings_revision": 1,
            })
        self.assertEqual(ctx.exception.current, 2)

    def test_concurrent_save_same_expected_revision_one_succeeds_one_conflicts(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            json.dumps({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "CNY",
                "settings_revision": 1,
            }),
            encoding="utf-8",
        )
        from ledger.services.settings import SettingsRevisionConflict, save_settings

        barrier = threading.Barrier(2)
        results: list[tuple[str, object]] = []
        lock = threading.Lock()

        def attempt(suffix: str) -> None:
            barrier.wait()
            try:
                payload = save_settings({
                    "write_target": f"ledger/2026-{suffix}.bean",
                    "expected_settings_revision": 1,
                })
            except SettingsRevisionConflict as exc:
                with lock:
                    results.append(("conflict", exc.current))
            else:
                with lock:
                    results.append(("ok", payload["write_target"]))

        threads = [
            threading.Thread(target=attempt, args=("a",)),
            threading.Thread(target=attempt, args=("b",)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        outcomes = {kind for kind, _ in results}
        self.assertEqual(outcomes, {"ok", "conflict"})
        ok_targets = [value for kind, value in results if kind == "ok"]
        self.assertEqual(len(ok_targets), 1)
        conflict_revisions = [value for kind, value in results if kind == "conflict"]
        self.assertEqual(conflict_revisions, [2])

        on_disk = json.loads(self._settings_path().read_text(encoding="utf-8"))
        self.assertEqual(on_disk["settings_revision"], 2)
        self.assertEqual(on_disk["write_target"], ok_targets[0])

    def test_unknown_filter_presets_schema_blocks_overwrite(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            json.dumps({
                "write_target": "ledger/2026.bean",
                "reporting_currency": "CNY",
                "filter_presets_schema_version": 99,
                "filter_presets": [{"id": "x", "name": "旧"}],
            }),
            encoding="utf-8",
        )
        from ledger.services.settings import SettingsSchemaVersionError

        with self.assertRaises(SettingsSchemaVersionError):
            self.save_settings({
                "write_target": "ledger/2026.bean",
                "expected_settings_revision": 1,
                "filter_presets": [],
            })


if __name__ == "__main__":
    raise SystemExit(unittest.main())

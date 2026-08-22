import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PYTHON_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ROOT))


class SettingsTests(unittest.TestCase):
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
        })
        self.assertEqual(json.loads(self._settings_path().read_text(encoding="utf-8")), saved)

    def test_api_legacy_put_preserves_reporting_currency(self):
        self._settings_path().parent.mkdir(parents=True)
        self._settings_path().write_text(
            '{"write_target":"ledger/2026.bean","reporting_currency":"EUR"}',
            encoding="utf-8",
        )
        from ledger.api.settings import SettingsModel, update_settings

        saved = update_settings(SettingsModel(write_target="ledger/2027.bean"))

        self.assertEqual(saved, {
            "write_target": "ledger/2027.bean",
            "reporting_currency": "EUR",
            "card_stripes": self.DEFAULT_CARD_STRIPES,
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


if __name__ == "__main__":
    raise SystemExit(unittest.main())

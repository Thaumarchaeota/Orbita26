import json

import re

from ledger.config import DATA_DIR
from ledger.services.io import resolve_data_path

SETTINGS_DIR = DATA_DIR / ".bkeasy"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
DEFAULT_WRITE_TARGET = "ledger/2026.bean"
DEFAULT_REPORTING_CURRENCY = "CNY"
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

DEFAULT_CARD_STRIPES = {
    "expense": "#D48806",
    "proxy_expense": "#E8B35A",
    "income": "#4A8A62",
    "transfer": "#4A5A8A",
    "repayment": "#7AA3D4",
    "pad": "#C8C8C8",
    "balance": "#6A6A6A",
}


def _load_raw() -> dict:
    if not SETTINGS_FILE.is_file():
        return {}
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def validate_write_target(write_target: str) -> str:
    target = (write_target or "").strip().replace("\\", "/")
    if not target:
        raise ValueError("写入路径不能为空")
    resolve_data_path(target)
    return target


def get_write_target() -> str:
    raw = _load_raw()
    target = raw.get("write_target", DEFAULT_WRITE_TARGET)
    try:
        return validate_write_target(target)
    except ValueError:
        return DEFAULT_WRITE_TARGET


def validate_reporting_currency(reporting_currency: str) -> str:
    currency = (reporting_currency or "").strip().upper()
    if not _CURRENCY_RE.fullmatch(currency):
        raise ValueError("报告币种必须是 3 位大写字母")
    return currency


def validate_hex_color(color: str) -> str:
    value = (color or "").strip()
    if not _HEX_COLOR_RE.fullmatch(value):
        raise ValueError("颜色必须是 #RRGGBB 格式")
    return value.upper()


def get_card_stripes() -> dict:
    raw = _load_raw().get("card_stripes")
    merged = dict(DEFAULT_CARD_STRIPES)
    if isinstance(raw, dict):
        for key in DEFAULT_CARD_STRIPES:
            if key in raw:
                merged[key] = validate_hex_color(str(raw[key]))
    return merged


def _merge_card_stripes(data: dict) -> dict:
    if "card_stripes" not in data:
        return get_card_stripes()
    raw = data.get("card_stripes")
    if raw is None:
        return get_card_stripes()
    if not isinstance(raw, dict):
        raise ValueError("card_stripes 必须是对象")
    merged = get_card_stripes()
    for key in DEFAULT_CARD_STRIPES:
        if key in raw:
            merged[key] = validate_hex_color(str(raw[key]))
    return merged


def get_reporting_currency() -> str:
    raw = _load_raw()
    currency = raw.get("reporting_currency", DEFAULT_REPORTING_CURRENCY)
    try:
        return validate_reporting_currency(currency)
    except ValueError:
        return DEFAULT_REPORTING_CURRENCY


def get_settings() -> dict:
    return {
        "write_target": get_write_target(),
        "reporting_currency": get_reporting_currency(),
        "card_stripes": get_card_stripes(),
    }


def save_settings(data: dict) -> dict:
    write_target = validate_write_target(data.get("write_target", ""))
    # Old clients only submit write_target. Keep the reporting currency already
    # chosen by the user instead of silently resetting the statistics display.
    reporting_currency = validate_reporting_currency(
        data.get("reporting_currency", get_reporting_currency())
    )
    card_stripes = _merge_card_stripes(data)
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "write_target": write_target,
        "reporting_currency": reporting_currency,
        "card_stripes": card_stripes,
    }
    SETTINGS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload

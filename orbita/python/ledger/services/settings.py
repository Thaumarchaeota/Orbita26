import json

from ledger.config import DATA_DIR
from ledger.services.io import resolve_data_path

SETTINGS_DIR = DATA_DIR / ".bkeasy"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
DEFAULT_WRITE_TARGET = "ledger/2026.bean"


def _load_raw() -> dict:
    if not SETTINGS_FILE.is_file():
        return {"write_target": DEFAULT_WRITE_TARGET}
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"write_target": DEFAULT_WRITE_TARGET}
    if not isinstance(data, dict):
        return {"write_target": DEFAULT_WRITE_TARGET}
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


def get_settings() -> dict:
    return {"write_target": get_write_target()}


def save_settings(data: dict) -> dict:
    write_target = validate_write_target(data.get("write_target", ""))
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"write_target": write_target}
    SETTINGS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload

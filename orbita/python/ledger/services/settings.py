import json
import re
import threading
from dataclasses import dataclass
from datetime import date

from ledger.config import DATA_DIR
from ledger.services.io import atomic_write, file_exclusive_lock, resolve_data_path

SETTINGS_DIR = DATA_DIR / ".bkeasy"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
SETTINGS_LOCK_FILE = SETTINGS_DIR / "settings.json.lock"
_settings_save_lock = threading.Lock()
DEFAULT_WRITE_TARGET = "ledger/2026.bean"
DEFAULT_REPORTING_CURRENCY = "CNY"
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DEFAULT_CARD_STRIPES = {
    "expense": "#D48806",
    "proxy_expense": "#E8B35A",
    "income": "#4A8A62",
    "transfer": "#4A5A8A",
    "repayment": "#7AA3D4",
    "pad": "#C8C8C8",
    "balance": "#6A6A6A",
}

FILTER_PRESETS_VERSION_DEFAULT = 1
FILTER_PRESETS_SCHEMA_VERSION = 1
SETTINGS_REVISION_DEFAULT = 1
class SettingsRevisionConflict(Exception):
    def __init__(self, current: int):
        self.current = current
        super().__init__(f"设置 revision 冲突，当前为 {current}")


class SettingsSchemaVersionError(ValueError):
    pass


_VALID_TYPE_MODES = frozenset({"all", "selected"})
_VALID_SET_MODES = frozenset({"or", "and"})
_VALID_DATE_MODES = frozenset({"all", "relative", "absolute"})
_VALID_RELATIVE_PRESETS = frozenset({"today", "last7", "thisMonth", "thisYear", "all"})
_VALID_FILTER_TYPES = frozenset({
    "expense",
    "proxy-expense",
    "income",
    "transfer",
    "repayment",
    "unknown",
    "pad",
    "balance",
})


@dataclass
class _SettingsLoadState:
    data: dict | None
    raw_text: str | None
    json_error: str | None


def _settings_diagnostic(
    *,
    code: str,
    message: str,
    path: str,
    index: int | None = None,
    preset_id: str | None = None,
) -> dict:
    diag: dict = {"code": code, "message": message, "path": path}
    if index is not None:
        diag["index"] = index
    if preset_id is not None:
        diag["preset_id"] = preset_id
    return diag


def _load_settings_file() -> _SettingsLoadState:
    if not SETTINGS_FILE.is_file():
        return _SettingsLoadState(data={}, raw_text=None, json_error=None)
    try:
        raw_text = SETTINGS_FILE.read_text(encoding="utf-8")
    except OSError as exc:
        return _SettingsLoadState(data=None, raw_text=None, json_error=str(exc))
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        return _SettingsLoadState(data=None, raw_text=raw_text, json_error=str(exc))
    if not isinstance(data, dict):
        return _SettingsLoadState(
            data=None,
            raw_text=raw_text,
            json_error="settings.json 根节点必须是对象",
        )
    return _SettingsLoadState(data=data, raw_text=raw_text, json_error=None)


def _load_raw() -> dict:
    state = _load_settings_file()
    if state.json_error is not None or state.data is None:
        return {}
    return state.data


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


def _validate_string_list(value, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field} 必须是数组")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field} 必须是字符串数组")
        out.append(item.strip())
    return out


def _validate_iso_date(value: str) -> bool:
    if not _ISO_DATE_RE.fullmatch(value):
        return False
    try:
        y, m, d = map(int, value.split("-"))
        date(y, m, d)
    except ValueError:
        return False
    return True


def _diagnose_filter_preset_date(raw, path: str) -> tuple[dict | None, list[dict]]:
    diags: list[dict] = []
    if not isinstance(raw, dict):
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="date 必须是对象",
                path=path,
            )
        ]
    mode = raw.get("mode")
    if mode not in _VALID_DATE_MODES:
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="date.mode 无效",
                path=f"{path}.mode",
            )
        ]
    if mode == "all":
        return {"mode": "all"}, []
    if mode == "relative":
        preset = raw.get("preset")
        if preset not in _VALID_RELATIVE_PRESETS:
            return None, [
                _settings_diagnostic(
                    code="filter_preset_invalid",
                    message="date.preset 无效",
                    path=f"{path}.preset",
                )
            ]
        return {"mode": "relative", "preset": preset}, []
    date_from = raw.get("from")
    date_to = raw.get("to")
    if not isinstance(date_from, str) or not isinstance(date_to, str):
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="绝对日期必须提供 from 和 to",
                path=path,
            )
        ]
    date_from = date_from.strip()
    date_to = date_to.strip()
    if not date_from or not date_to:
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="绝对日期不能为空",
                path=path,
            )
        ]
    if not _validate_iso_date(date_from):
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="date.from 必须是 YYYY-MM-DD 格式",
                path=f"{path}.from",
            )
        )
    if not _validate_iso_date(date_to):
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="date.to 必须是 YYYY-MM-DD 格式",
                path=f"{path}.to",
            )
        )
    if diags:
        return None, diags
    if date_from > date_to:
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="date.from 不能晚于 date.to",
                path=path,
            )
        ]
    return {"mode": "absolute", "from": date_from, "to": date_to}, []


def _diagnose_filter_preset(raw, index: int) -> tuple[dict | None, list[dict]]:
    path = f"filter_presets[{index}]"
    diags: list[dict] = []
    preset_id: str | None = None
    if not isinstance(raw, dict):
        return None, [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="预设必须是对象",
                path=path,
                index=index,
            )
        ]
    raw_id = raw.get("id")
    if isinstance(raw_id, str) and raw_id.strip():
        preset_id = raw_id.strip()
    name = raw.get("name")
    if not isinstance(raw_id, str) or not raw_id.strip():
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="id 不能为空",
                path=f"{path}.id",
                index=index,
                preset_id=preset_id,
            )
        )
    if not isinstance(name, str) or not name.strip():
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="name 不能为空",
                path=f"{path}.name",
                index=index,
                preset_id=preset_id,
            )
        )
    date_value, date_diags = _diagnose_filter_preset_date(raw.get("date"), f"{path}.date")
    for diag in date_diags:
        diag["index"] = index
        if preset_id is not None:
            diag["preset_id"] = preset_id
    diags.extend(date_diags)
    type_mode = raw.get("typeMode")
    if type_mode not in _VALID_TYPE_MODES:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="typeMode 无效",
                path=f"{path}.typeMode",
                index=index,
                preset_id=preset_id,
            )
        )
    try:
        types = _validate_string_list(raw.get("types", []), "types")
    except ValueError as exc:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message=str(exc),
                path=f"{path}.types",
                index=index,
                preset_id=preset_id,
            )
        )
        types = []
    else:
        if any(t not in _VALID_FILTER_TYPES for t in types):
            diags.append(
                _settings_diagnostic(
                    code="filter_preset_invalid",
                    message="types 包含无效条目",
                    path=f"{path}.types",
                    index=index,
                    preset_id=preset_id,
                )
            )
    try:
        accounts = _validate_string_list(raw.get("accounts", []), "accounts")
    except ValueError as exc:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message=str(exc),
                path=f"{path}.accounts",
                index=index,
                preset_id=preset_id,
            )
        )
        accounts = []
    account_mode = raw.get("accountMode")
    if account_mode not in _VALID_SET_MODES:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="accountMode 无效",
                path=f"{path}.accountMode",
                index=index,
                preset_id=preset_id,
            )
        )
    try:
        tags = _validate_string_list(raw.get("tags", []), "tags")
    except ValueError as exc:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message=str(exc),
                path=f"{path}.tags",
                index=index,
                preset_id=preset_id,
            )
        )
        tags = []
    tag_mode = raw.get("tagMode")
    if tag_mode not in _VALID_SET_MODES:
        diags.append(
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="tagMode 无效",
                path=f"{path}.tagMode",
                index=index,
                preset_id=preset_id,
            )
        )
    if diags:
        return None, diags
    return {
        "id": raw_id.strip(),
        "name": name.strip(),
        "date": date_value,
        "typeMode": type_mode,
        "types": types,
        "accounts": accounts,
        "accountMode": account_mode,
        "tags": tags,
        "tagMode": tag_mode,
    }, []


def _validate_filter_preset_strict(raw, index: int | None = None) -> dict:
    if index is None:
        validated, diags = _diagnose_filter_preset(raw, 0)
    else:
        validated, diags = _diagnose_filter_preset(raw, index)
    if validated is None:
        raise ValueError(diags[0]["message"] if diags else "预设无效")
    return validated


def _parse_filter_presets(raw) -> tuple[list[dict], list[dict]]:
    if raw is None:
        return [], []
    if not isinstance(raw, list):
        return [], [
            _settings_diagnostic(
                code="filter_preset_invalid",
                message="filter_presets 必须是数组",
                path="filter_presets",
            )
        ]
    out: list[dict] = []
    diags: list[dict] = []
    for index, item in enumerate(raw):
        validated, item_diags = _diagnose_filter_preset(item, index)
        if validated is not None:
            out.append(validated)
        diags.extend(item_diags)
    return out, diags


def get_filter_presets_version() -> int:
    raw = _load_raw().get("filter_presets_version", FILTER_PRESETS_VERSION_DEFAULT)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return FILTER_PRESETS_VERSION_DEFAULT
    return raw


def get_filter_presets_schema_version() -> int:
    raw = _load_raw().get("filter_presets_schema_version", FILTER_PRESETS_SCHEMA_VERSION)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return FILTER_PRESETS_SCHEMA_VERSION
    return raw


def get_settings_revision() -> int:
    raw = _load_raw().get("settings_revision", SETTINGS_REVISION_DEFAULT)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return SETTINGS_REVISION_DEFAULT
    return raw


def settings_etag(revision: int | None = None) -> str:
    rev = revision if revision is not None else get_settings_revision()
    return f'"settings-revision-{rev}"'


def get_filter_presets() -> list[dict]:
    presets, _ = _parse_filter_presets(_load_raw().get("filter_presets"))
    return presets


def _merge_filter_presets(data: dict, raw: dict) -> tuple[int, list]:
    if "filter_presets" not in data:
        version = raw.get("filter_presets_version", get_filter_presets_version())
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            version = FILTER_PRESETS_VERSION_DEFAULT
        presets = raw.get("filter_presets", [])
        if presets is None:
            presets = []
        return version, presets
    raw_version = data.get("filter_presets_version", raw.get("filter_presets_version", FILTER_PRESETS_VERSION_DEFAULT))
    if isinstance(raw_version, bool) or not isinstance(raw_version, int) or raw_version < 1:
        version = FILTER_PRESETS_VERSION_DEFAULT
    else:
        version = raw_version
    incoming = data.get("filter_presets")
    if not isinstance(incoming, list):
        raise ValueError("filter_presets 必须是数组")
    presets = [_validate_filter_preset_strict(item, index) for index, item in enumerate(incoming)]
    return version, presets


def get_settings() -> dict:
    state = _load_settings_file()
    diagnostics: list[dict] = []
    if state.json_error is not None:
        diagnostics.append(
            _settings_diagnostic(
                code="settings_json_invalid",
                message=f"settings.json 无法解析: {state.json_error}",
                path="settings.json",
            )
        )
        result = {
            "write_target": DEFAULT_WRITE_TARGET,
            "reporting_currency": DEFAULT_REPORTING_CURRENCY,
            "card_stripes": dict(DEFAULT_CARD_STRIPES),
            "settings_revision": SETTINGS_REVISION_DEFAULT,
            "filter_presets_schema_version": FILTER_PRESETS_SCHEMA_VERSION,
            "filter_presets_version": FILTER_PRESETS_VERSION_DEFAULT,
            "filter_presets": [],
        }
        if diagnostics:
            result["diagnostics"] = diagnostics
        return result
    raw = state.data or {}
    presets, preset_diags = _parse_filter_presets(raw.get("filter_presets"))
    diagnostics.extend(preset_diags)
    schema_version = get_filter_presets_schema_version()
    if schema_version > FILTER_PRESETS_SCHEMA_VERSION:
        diagnostics.append(
            _settings_diagnostic(
                code="filter_presets_schema_unknown",
                message=(
                    f"filter_presets_schema_version={schema_version} 超出当前支持版本 "
                    f"{FILTER_PRESETS_SCHEMA_VERSION}，预设已保留但未按现行 schema 解析"
                ),
                path="filter_presets_schema_version",
            )
        )
        presets = []
    result = {
        "write_target": get_write_target(),
        "reporting_currency": get_reporting_currency(),
        "card_stripes": get_card_stripes(),
        "settings_revision": get_settings_revision(),
        "filter_presets_schema_version": schema_version,
        "filter_presets_version": get_filter_presets_version(),
        "filter_presets": presets,
    }
    if diagnostics:
        result["diagnostics"] = diagnostics
    return result


def _revision_from_raw(raw: dict) -> int:
    value = raw.get("settings_revision", SETTINGS_REVISION_DEFAULT)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return SETTINGS_REVISION_DEFAULT
    return value


def _schema_version_from_raw(raw: dict) -> int:
    value = raw.get("filter_presets_schema_version", FILTER_PRESETS_SCHEMA_VERSION)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return FILTER_PRESETS_SCHEMA_VERSION
    return value


def save_settings(data: dict) -> dict:
    with _settings_save_lock:
        with file_exclusive_lock(SETTINGS_LOCK_FILE):
            state = _load_settings_file()
            if state.json_error is not None:
                raise ValueError("settings.json 已损坏，请先修复后再保存")
            raw = dict(state.data or {})
            current_revision = _revision_from_raw(raw)
            expected = data.get("expected_settings_revision")
            if expected is not None:
                if isinstance(expected, bool) or not isinstance(expected, int) or expected < 1:
                    raise ValueError("expected_settings_revision 无效")
                if expected != current_revision:
                    raise SettingsRevisionConflict(current_revision)
            on_disk_schema = _schema_version_from_raw(raw)
            if on_disk_schema > FILTER_PRESETS_SCHEMA_VERSION and "filter_presets" in data:
                raise SettingsSchemaVersionError(
                    f"filter_presets_schema_version={on_disk_schema} 超出当前支持版本，"
                    "不得静默覆盖未知 schema 的预设"
                )
            write_target = validate_write_target(
                data.get("write_target", raw.get("write_target", ""))
            )
            reporting_currency = validate_reporting_currency(
                data.get(
                    "reporting_currency",
                    raw.get("reporting_currency", DEFAULT_REPORTING_CURRENCY),
                )
            )
            card_stripes = _merge_card_stripes(data)
            filter_presets_version, filter_presets = _merge_filter_presets(data, raw)
            next_revision = current_revision + 1
            payload = dict(raw)
            payload.update({
                "write_target": write_target,
                "reporting_currency": reporting_currency,
                "card_stripes": card_stripes,
                "settings_revision": next_revision,
                "filter_presets_schema_version": FILTER_PRESETS_SCHEMA_VERSION,
                "filter_presets_version": filter_presets_version,
                "filter_presets": filter_presets,
            })
            atomic_write(
                SETTINGS_FILE,
                json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            )
            return payload

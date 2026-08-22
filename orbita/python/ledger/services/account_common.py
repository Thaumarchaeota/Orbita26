import re
from pathlib import Path

from ledger.config import ACCOUNT_FILE, CATEGORY_FILE, DATA_DIR, LEDGER_DIR
from ledger.services.open_line import group_for_name, parse_open_line, render_open_line

ACCOUNT_SEGMENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
WALLET_ROOTS = frozenset({"Assets", "Liabilities"})


def validate_account_name(name: str, *, wallet_only: bool = False) -> None:
    account = (name or "").strip()
    if not account:
        raise ValueError("账户名不能为空")
    parts = account.split(":")
    if len(parts) < 2:
        raise ValueError("账户名须包含根类型与至少一层子级")
    root = parts[0]
    if wallet_only and root not in WALLET_ROOTS:
        raise ValueError("账户须以 Assets: 或 Liabilities: 开头")
    if not wallet_only and group_for_name(account) is None:
        raise ValueError("无效账户根类型")
    for part in parts[1:]:
        if not part or not ACCOUNT_SEGMENT_RE.match(part):
            raise ValueError(f"无效账户段: {part or '(空)'}")


def rename_account_ref(account: str, old: str, new: str) -> str:
    if account == old:
        return new
    prefix = f"{old}:"
    if account.startswith(prefix):
        return new + account[len(old) :]
    return account


def ledger_year_files() -> list[tuple[str, Path]]:
    if not LEDGER_DIR.is_dir():
        return []
    files: list[tuple[str, Path]] = []
    for path in sorted(LEDGER_DIR.glob("*.bean")):
        if path.name.endswith("_inv.bean"):
            continue
        rel = path.relative_to(DATA_DIR).as_posix()
        files.append((rel, path))
    return files


def declaration_file_for_name(name: str) -> tuple[Path, str]:
    group = group_for_name(name)
    if group in ("expenses", "income"):
        return CATEGORY_FILE, "category.bean"
    if group in ("assets", "liabilities"):
        return ACCOUNT_FILE, "account.bean"
    raise ValueError("无效账户根类型")


def find_open_line(name: str) -> tuple[Path, str, int, dict] | None:
    for path, source_file in ((ACCOUNT_FILE, "account.bean"), (CATEGORY_FILE, "category.bean")):
        if not path.is_file():
            continue
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            item = parse_open_line(line, source_file, line_no)
            if item and item["name"] == name:
                return path, source_file, line_no, item
    return None


def append_open_line(
    name: str,
    *,
    open_date: str,
    extra: str = "",
    label: str = "",
) -> tuple[Path, str]:
    path, source_file = declaration_file_for_name(name)
    line = render_open_line(open_date, name, extra, label)
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        if text and not text.endswith("\n"):
            text += "\n"
        text += line + "\n"
    else:
        text = line + "\n"
    return path, text


def rewrite_open_lines(text: str, source_file: str, old: str, new: str) -> tuple[str, int]:
    lines = text.splitlines(keepends=True)
    changed = 0
    for idx, raw in enumerate(lines):
        item = parse_open_line(raw, source_file, idx + 1)
        if not item:
            continue
        renamed = rename_account_ref(item["name"], old, new)
        if renamed == item["name"]:
            continue
        nl = ""
        if raw.endswith("\r\n"):
            nl = "\r\n"
        elif raw.endswith("\n"):
            nl = "\n"
        lines[idx] = render_open_line(
            item["open_date"],
            renamed,
            item.get("extra") or "",
            item.get("label") or "",
        ) + nl
        changed += 1
    return "".join(lines), changed

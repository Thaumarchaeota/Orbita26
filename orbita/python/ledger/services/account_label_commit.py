from ledger.config import ACCOUNT_FILE
from ledger.services.io import atomic_write
from ledger.services.open_line import OPEN_RE, render_open_line


def _validate_account(acc: dict) -> None:
    name = (acc.get("name") or "").strip()
    if not name.startswith("Assets:") and not name.startswith("Liabilities:"):
        raise ValueError(f"无效账户: {name}")
    if acc.get("source_file") != "account.bean":
        raise ValueError(f"无效来源文件: {acc.get('source_file')}")
    source_line = int(acc.get("source_line") or 0)
    if source_line < 1:
        raise ValueError("无效行号")


def commit_account_labels(accounts: list[dict]) -> None:
    if not ACCOUNT_FILE.is_file():
        raise ValueError("account.bean 不存在")
    lines = ACCOUNT_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
    for acc in accounts:
        _validate_account(acc)
        source_line = int(acc["source_line"])
        if source_line > len(lines):
            raise ValueError(f"行号超出范围: {source_line}")
        idx = source_line - 1
        current = lines[idx].rstrip("\n\r")
        if not OPEN_RE.match(current.strip()):
            raise ValueError(f"第 {source_line} 行不是 open 行")
        raw = lines[idx]
        if raw.endswith("\r\n"):
            nl = "\r\n"
        elif raw.endswith("\n"):
            nl = "\n"
        else:
            nl = ""
        lines[idx] = render_open_line(
            acc.get("open_date") or "2026-01-01",
            acc["name"].strip(),
            acc.get("extra") or "",
            acc.get("label") or "",
        ) + nl
    atomic_write(ACCOUNT_FILE, "".join(lines))

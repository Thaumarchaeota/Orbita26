import re
from datetime import date

from ledger.services.account_common import (
    append_open_line,
    ledger_year_files,
    validate_account_name,
)
from ledger.services.accounts import all_declared_account_names
from ledger.services.io import atomic_write
from ledger.services.parser import parse_file

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _scan_earlier_references(name: str, open_date: str) -> list[dict]:
    refs: list[dict] = []
    open_day = date.fromisoformat(open_date)
    for source_file, path in ledger_year_files():
        if not path.is_file():
            continue
        parsed = parse_file(path, source_file)
        for item in parsed.items:
            item_date = date.fromisoformat(item.date)
            fields: list[tuple[str, str]] = []
            if hasattr(item, "postings"):
                for posting in item.postings:
                    if posting.account == name:
                        fields.append(("posting", posting.account))
            elif item.kind == "pad":
                if item.account == name:
                    fields.append(("account", item.account))
                if item.source_account == name:
                    fields.append(("source_account", item.source_account))
            elif item.kind == "balance":
                if item.account == name:
                    fields.append(("account", item.account))
            for field, account in fields:
                refs.append(
                    {
                        "kind": item.kind,
                        "source_file": item.source_file,
                        "source_line": item.source_line,
                        "date": item.date,
                        "field": field,
                        "account": account,
                        "before_open": item_date < open_day,
                    }
                )
    return refs


def create_account(
    name: str,
    *,
    open_date: str = "2026-01-01",
    extra: str = "",
    label: str = "",
) -> dict:
    account = (name or "").strip()
    validate_account_name(account, wallet_only=True)
    open_date = (open_date or "").strip()
    if not DATE_RE.match(open_date):
        raise ValueError("开户日期格式须为 YYYY-MM-DD")

    declared = set(all_declared_account_names())
    if account in declared:
        raise ValueError("账户已存在")
    # ADR 0004 leaves historical parent opens readable, but a new open must not
    # create or preserve a selectable parent account for future account management.
    if any(name.startswith(f"{account}:") for name in declared):
        raise ValueError("账户已有子账户，不能创建为 open 父账户")
    ancestors = [
        ":".join(account.split(":")[:depth])
        for depth in range(1, len(account.split(":")))
    ]
    if any(parent in declared for parent in ancestors):
        raise ValueError("父账户已 open，不能在其下创建子账户")

    refs = _scan_earlier_references(account, open_date)
    earlier = [r for r in refs if r["before_open"]]
    if earlier:
        first = min(earlier, key=lambda r: r["date"])
        raise ValueError(
            f"存在早于开户日 {open_date} 的引用（{first['source_file']}:{first['source_line']}）"
        )
    if refs:
        first = min(refs, key=lambda r: r["date"])
        raise ValueError(
            f"账本已引用该账户（{first['source_file']}:{first['source_line']}），请先迁移或清理"
        )

    path, text = append_open_line(
        account,
        open_date=open_date,
        extra=(extra or "").strip(),
        label=(label or "").strip(),
    )
    atomic_write(path, text)
    return {
        "ok": True,
        "account": account,
        "source_file": path.name,
        "open_date": open_date,
        "extra": (extra or "").strip(),
        "label": (label or "").strip(),
    }

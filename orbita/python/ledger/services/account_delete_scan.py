from pathlib import Path

from ledger.config import DATA_DIR, LEDGER_DIR
from ledger.services.accounts import all_declared_account_names
from ledger.services.ledger_item import Balance, Pad, Transaction
from ledger.services.parser import parse_file


def _ledger_year_files() -> list[tuple[str, Path]]:
    if not LEDGER_DIR.is_dir():
        return []
    files: list[tuple[str, Path]] = []
    for path in sorted(LEDGER_DIR.glob("*.bean")):
        if path.name.endswith("_inv.bean"):
            continue
        rel = path.relative_to(DATA_DIR).as_posix()
        files.append((rel, path))
    return files


def _child_accounts(name: str, declared: list[str]) -> list[str]:
    prefix = f"{name}:"
    return sorted(account for account in declared if account.startswith(prefix))


def _append_reference(
    references: list[dict],
    *,
    kind: str,
    source_file: str,
    source_line: int,
    item_id: str,
    date: str,
    field: str,
    account: str,
) -> None:
    references.append(
        {
            "kind": kind,
            "source_file": source_file,
            "source_line": source_line,
            "item_id": item_id,
            "date": date,
            "field": field,
            "account": account,
        }
    )


def scan_account_delete(name: str) -> dict:
    account = (name or "").strip()
    if not account:
        raise ValueError("账户名不能为空")

    declared = all_declared_account_names()
    declared_set = set(declared)
    exists = account in declared_set
    child_accounts = _child_accounts(account, declared) if exists else []
    references: list[dict] = []

    if exists:
        for source_file, path in _ledger_year_files():
            if not path.is_file():
                continue
            parsed = parse_file(path, source_file)
            for item in parsed.items:
                if isinstance(item, Transaction):
                    for posting in item.postings:
                        if posting.account == account:
                            _append_reference(
                                references,
                                kind="transaction",
                                source_file=item.source_file,
                                source_line=item.source_line,
                                item_id=item.id,
                                date=item.date,
                                field="posting",
                                account=posting.account,
                            )
                elif isinstance(item, Pad):
                    if item.account == account:
                        _append_reference(
                            references,
                            kind="pad",
                            source_file=item.source_file,
                            source_line=item.source_line,
                            item_id=item.id,
                            date=item.date,
                            field="account",
                            account=item.account,
                        )
                    if item.source_account == account:
                        _append_reference(
                            references,
                            kind="pad",
                            source_file=item.source_file,
                            source_line=item.source_line,
                            item_id=item.id,
                            date=item.date,
                            field="source_account",
                            account=item.source_account,
                        )
                elif isinstance(item, Balance):
                    if item.account == account:
                        _append_reference(
                            references,
                            kind="balance",
                            source_file=item.source_file,
                            source_line=item.source_line,
                            item_id=item.id,
                            date=item.date,
                            field="account",
                            account=item.account,
                        )

    can_delete = exists and not references and not child_accounts
    return {
        "ok": True,
        "account": account,
        "exists": exists,
        "can_delete": can_delete,
        "child_accounts": child_accounts,
        "references": references,
        "reference_count": len(references),
        "child_account_count": len(child_accounts),
    }

from datetime import date

from ledger.services.io import atomic_write, resolve_data_path
from ledger.services.models import Entry, Posting
from ledger.services.render import render_file
from ledger.services.validate import validate_entries


def _fill_implicit_amounts(entry: Entry) -> None:
    total = sum(p.amount for p in entry.postings)
    if abs(total) < 0.001:
        for p in entry.postings:
            if not (p.currency or "").strip():
                p.currency = "CNY"
        return
    zeros = [p for p in entry.postings if p.amount == 0]
    if len(zeros) == 1:
        zeros[0].amount = round(-total, 2)
        non_zero = [p for p in entry.postings if p is not zeros[0] and p.amount != 0]
        nz_currencies = {(p.currency or "").strip() for p in non_zero}
        if len(nz_currencies) == 1:
            zeros[0].currency = next(iter(nz_currencies)) or "CNY"
        elif not (zeros[0].currency or "").strip():
            zeros[0].currency = "CNY"
    for p in entry.postings:
        if not (p.currency or "").strip():
            p.currency = "CNY"


def entry_from_dict(d: dict) -> Entry:
    postings = [
        Posting(
            account=p.get("account", ""),
            amount=float(p.get("amount", 0)),
            currency=p.get("currency", "") or "CNY",
            cost_amount=p.get("cost_amount"),
            cost_currency=p.get("cost_currency", "") or "",
        )
        for p in (d.get("postings") or [])
    ]
    return Entry(
        id=d.get("id", ""),
        source_file=d.get("source_file", ""),
        source_line=int(d.get("source_line", 0)),
        type=d.get("type", "expense"),
        date=d.get("date", ""),
        flag=d.get("flag", "*"),
        payee=d.get("payee", ""),
        remark=d.get("remark", ""),
        tags=d.get("tags", ""),
        postings=postings,
        seq=d.get("seq", "") or "",
    )


def sort_for_commit(entries: list[Entry]) -> list[Entry]:
    def key(e: Entry) -> tuple:
        d = date.fromisoformat(e.date)
        seq = (e.seq or "").strip()
        if not seq:
            seq = f"z{e.source_line:09d}"
        return (d.toordinal(), seq)

    return sorted(entries, key=key)


def commit_file(source_file: str, entries: list[Entry]) -> None:
    path = resolve_data_path(source_file)

    for e in entries:
        _fill_implicit_amounts(e)

    errors = validate_entries(entries)
    if errors:
        msg = errors[0]["error"]
        raise ValueError(msg)

    sorted_entries = sort_for_commit(entries)
    text = render_file(sorted_entries)
    atomic_write(path, text)


def commit_files(files: dict[str, list[Entry]]) -> tuple[list[dict], bool]:
    results: list[dict] = []
    all_ok = True
    for source_file, entries in files.items():
        try:
            commit_file(source_file, entries)
            results.append({"file": source_file, "ok": True})
        except Exception as e:
            all_ok = False
            results.append({"file": source_file, "ok": False, "error": str(e)})
    return results, all_ok

import re
from datetime import date
from pathlib import Path

from ledger.config import DATA_DIR
from ledger.services.models import Entry, Posting
from ledger.services.settings import get_write_target

HEADER_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(.*)$'
)
POSTING_RE = re.compile(r'^\s{2,}(\S+)\s*(.*)$')
METADATA_RE = re.compile(r'^\s+bkeasy-type:\s*"([^"]+)"\s*$')
AMOUNT_RE = re.compile(r'^(-?\d+(?:\.\d+)?)(?:\s+(\S+))?')


def infer_type_from_postings(postings: list[Posting]) -> str:
    has_expense = any(p.account.startswith("Expenses:") for p in postings)
    has_income = any(p.account.startswith("Income:") for p in postings)
    if has_expense:
        return "expense"
    if has_income:
        return "income"
    return "transfer"


def _parse_posting_tail(tail: str) -> tuple[float, str, float | None, str]:
    tail = tail.strip()
    cost_amount: float | None = None
    cost_currency = ""
    if "@@" in tail:
        amount_part, cost_part = tail.split("@@", 1)
        tail = amount_part.strip()
        cm = AMOUNT_RE.match(cost_part.strip())
        if cm:
            cost_amount = float(cm.group(1))
            cost_currency = (cm.group(2) or "").strip()
    if not tail:
        return 0.0, "", cost_amount, cost_currency
    m = AMOUNT_RE.match(tail)
    if not m:
        return 0.0, "", cost_amount, cost_currency
    amount = float(m.group(1))
    currency = (m.group(2) or "").strip()
    if currency == "{}":
        currency = ""
    return amount, currency, cost_amount, cost_currency


def parse_file(path: Path, source_file: str | None = None) -> list[Entry]:
    if source_file is None:
        source_file = path.relative_to(DATA_DIR).as_posix()
    entries: list[Entry] = []
    current: Entry | None = None
    entry_type: str | None = None

    with path.open(encoding="utf-8") as f:
        for line_no, raw in enumerate(f, start=1):
            line = raw.rstrip("\n\r")
            stripped = line.strip()
            if not stripped or stripped.startswith(";"):
                continue

            hm = HEADER_RE.match(line)
            if hm:
                if current is not None:
                    if entry_type is None:
                        current.type = infer_type_from_postings(current.postings)
                    else:
                        current.type = entry_type
                    entries.append(current)
                tags = hm.group(5).strip()
                current = Entry(
                    id=f"{source_file}:{line_no}",
                    source_file=source_file,
                    source_line=line_no,
                    type="expense",
                    date=hm.group(1),
                    flag=hm.group(2),
                    payee=hm.group(3),
                    remark=hm.group(4),
                    tags=tags,
                    postings=[],
                )
                entry_type = None
                continue

            if current is not None:
                mm = METADATA_RE.match(line)
                if mm:
                    entry_type = mm.group(1)
                    continue

                pm = POSTING_RE.match(line)
                if pm:
                    amount, currency, cost_amount, cost_currency = _parse_posting_tail(
                        pm.group(2)
                    )
                    current.postings.append(
                        Posting(
                            account=pm.group(1),
                            amount=amount,
                            currency=currency,
                            cost_amount=cost_amount,
                            cost_currency=cost_currency,
                        )
                    )

    if current is not None:
        if entry_type is None:
            current.type = infer_type_from_postings(current.postings)
        else:
            current.type = entry_type
        entries.append(current)

    for entry in entries:
        _fill_implicit_amounts(entry)
    return entries


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


def _seq_num(seq: str, source_line: int) -> int:
    m = re.match(r"^a(\d+)$", (seq or "").strip())
    return int(m.group(1)) if m else source_line


def assign_initial_seq(entries: list[Entry]) -> None:
    counters: dict[str, int] = {}
    for entry in entries:
        idx = counters.get(entry.date, 0)
        entry.seq = f"a{idx}"
        counters[entry.date] = idx + 1


def sort_for_display(entries: list[Entry]) -> list[Entry]:
    def key(e: Entry) -> tuple:
        d = date.fromisoformat(e.date)
        return (-d.toordinal(), -_seq_num(e.seq, e.source_line))

    return sorted(entries, key=key)


_parse_cache: dict[str, tuple[float, list[Entry]]] = {}


def invalidate_parse_cache() -> None:
    _parse_cache.clear()


def _load_write_target_entries(path: Path, write_target: str) -> list[Entry]:
    key = str(path.resolve())
    mtime = path.stat().st_mtime
    cached = _parse_cache.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    entries = parse_file(path, write_target)
    assign_initial_seq(entries)
    entries = sort_for_display(entries)
    _parse_cache[key] = (mtime, entries)
    return entries


def parse_write_target() -> list[Entry]:
    write_target = get_write_target()
    path = DATA_DIR / write_target
    if not path.is_file():
        return []
    return _load_write_target_entries(path, write_target)

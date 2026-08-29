import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from ledger.config import DATA_DIR
from ledger.services.candidate import CandidateDiagnostic
from ledger.services.ledger_item import (
    Balance,
    LedgerItem,
    MetadataEntry,
    Pad,
    Posting,
    Transaction,
    decimal_str,
    extract_valid_txn_time,
    is_valid_orbita_id,
    seq_numeric,
)
from ledger.services.settings import get_write_target

POSTING_FLAG_RE = re.compile(r'^\s{2,}(!|\?|\*)\s+(\S+)\s*(.*)$')
POSTING_RE = re.compile(r'^\s{2,}(\S+)\s*(.*)$')
POSTING_AMOUNT_RE = re.compile(r'^(\S+)\s+(-?\d+(?:\.\d+)?)(?:\s+(\S+))?(?:\s+@@.*)?$')
KNOWN_TXN_META_KEYS = frozenset({"bkeasy-type", "orbita-id"})
POSTING_META_RE = re.compile(r'^\s{4,}')
UNSUPPORTED_DATED_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2})\s+(open|close|event|price|document|note|commodity|custom)\b'
)
UNSUPPORTED_UNDATED_RE = re.compile(r"^(option|include|plugin|commodity|custom)(\s|$)")
PAD_RE = re.compile(r'^(\d{4}-\d{2}-\d{2})\s+pad\s+(\S+)\s+(\S+)\s*$')
BALANCE_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2})\s+balance\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(\S+)\s*$'
)
AMOUNT_RE = re.compile(r'^(-?\d+(?:\.\d+)?)(?:\s+(\S+))?')
METADATA_KEY_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")
LINK_RE = re.compile(r'\^[\w-]+')
TAG_TOKEN_RE = re.compile(r"^#[^\s#]+$")


@dataclass
class ParseResult:
    items: list[LedgerItem] = field(default_factory=list)
    diagnostics: list[CandidateDiagnostic] = field(default_factory=list)


def _root(account: str) -> str:
    return (account or "").split(":", 1)[0]


def infer_type_from_postings(postings: list[Posting]) -> str:
    if len(postings) != 2:
        return ""
    roots = [_root(p.account) for p in postings]
    has_expense = any(r == "Expenses" for r in roots)
    has_income = any(r == "Income" for r in roots)
    has_asset_liab = any(r in ("Assets", "Liabilities") for r in roots)
    if has_expense and has_asset_liab:
        return "expense"
    if has_income and has_asset_liab:
        return "income"
    if all(r in ("Assets", "Liabilities") for r in roots):
        return "transfer"
    return ""


def _diag_line(line_no: int, message: str, raw: str | None = None) -> CandidateDiagnostic:
    return CandidateDiagnostic(
        message=f"第 {line_no} 行：{message}",
        item_ids=[],
        raw=raw,
    )


def is_valid_metadata_key(key: str) -> bool:
    return bool(METADATA_KEY_RE.match(key))


def decode_beancount_string_literal(text: str) -> tuple[str | None, bool]:
    raw = text.strip()
    if not raw:
        return "", True
    if not raw.startswith('"') or not raw.endswith('"') or len(raw) < 2:
        return None, False
    body = raw[1:-1]
    out: list[str] = []
    i = 0
    while i < len(body):
        ch = body[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        i += 1
        if i >= len(body):
            return None, False
        esc = body[i]
        if esc == "n":
            out.append("\n")
        elif esc == "r":
            out.append("\r")
        elif esc == "t":
            out.append("\t")
        elif esc in ('\\', '"'):
            out.append(esc)
        elif esc == "u":
            if i + 4 >= len(body):
                return None, False
            try:
                out.append(chr(int(body[i + 1 : i + 5], 16)))
            except ValueError:
                return None, False
            i += 4
        else:
            return None, False
        i += 1
    return "".join(out), True


def encode_beancount_string(value: str) -> str:
    parts = ['"']
    for ch in value:
        if ch == "\\":
            parts.append("\\\\")
        elif ch == '"':
            parts.append('\\"')
        elif ch == "\n":
            parts.append("\\n")
        elif ch == "\r":
            parts.append("\\r")
        elif ch == "\t":
            parts.append("\\t")
        else:
            parts.append(ch)
    parts.append('"')
    return "".join(parts)


def _split_quoted_string(text: str) -> tuple[str | None, str] | None:
    rest = text.lstrip()
    if not rest.startswith('"'):
        return None
    i = 1
    while i < len(rest):
        if rest[i] == "\\":
            i += 2
            continue
        if rest[i] == '"':
            decoded, ok = decode_beancount_string_literal(rest[: i + 1])
            if not ok:
                return None
            return decoded, rest[i + 1 :]
        i += 1
    return None


def _parse_transaction_header(line: str) -> tuple[str, str, str, str, str] | None:
    match = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\S+)\s+(.*)$", line)
    if not match:
        return None
    txn_date, flag, rest = match.groups()
    payee_split = _split_quoted_string(rest)
    if payee_split is None:
        return None
    payee, rest = payee_split
    remark_split = _split_quoted_string(rest)
    if remark_split is None:
        return None
    remark, tags_raw = remark_split
    return txn_date, flag, payee, remark, tags_raw.strip()


def _parse_posting_tail(
    tail: str,
) -> tuple[
    str | None,
    str,
    str | None,
    str | None,
    str | None,
    str | None,
    str | None,
    str | None,
    str | None,
]:
    tail = tail.strip()
    price_amount: str | None = None
    price_currency: str | None = None
    cost_amount: str | None = None
    cost_currency: str | None = None
    lot_amount: str | None = None
    lot_currency: str | None = None
    lot_date: str | None = None

    if "@@" in tail:
        amount_part, cost_part = tail.rsplit("@@", 1)
        tail = amount_part.strip()
        cm = AMOUNT_RE.match(cost_part.strip())
        if cm:
            cost_amount = decimal_str(cm.group(1))
            cost_currency = (cm.group(2) or "").strip() or None
    else:
        at_m = re.search(r"(?<![@])@(?!@)\s*(-?\d+(?:\.\d+)?)(?:\s+(\S+))?\s*$", tail)
        if at_m:
            price_amount = decimal_str(at_m.group(1))
            price_currency = (at_m.group(2) or "").strip() or None
            tail = tail[: at_m.start()].strip()

    lot_m = re.search(
        r"\{(-?\d+(?:\.\d+)?)\s+([^,}]+)(?:,\s*(\d{4}-\d{2}-\d{2}))?\}",
        tail,
    )
    if lot_m:
        lot_amount = decimal_str(lot_m.group(1))
        lot_currency = lot_m.group(2).strip()
        lot_date = (lot_m.group(3) or "").strip() or None
        tail = (tail[: lot_m.start()] + tail[lot_m.end() :]).strip()

    if not tail:
        return (
            None,
            "",
            price_amount,
            price_currency,
            cost_amount,
            cost_currency,
            lot_amount,
            lot_currency,
            lot_date,
        )
    m = AMOUNT_RE.match(tail)
    if not m:
        return (
            None,
            "",
            price_amount,
            price_currency,
            cost_amount,
            cost_currency,
            lot_amount,
            lot_currency,
            lot_date,
        )
    amount = decimal_str(m.group(1))
    currency = (m.group(2) or "").strip()
    if currency == "{}":
        currency = ""
    return (
        amount,
        currency,
        price_amount,
        price_currency,
        cost_amount,
        cost_currency,
        lot_amount,
        lot_currency,
        lot_date,
    )


def _parse_metadata_value(value: str) -> tuple[str | None, bool]:
    text = value.strip()
    if not text:
        return "", True
    if text.startswith('"'):
        return decode_beancount_string_literal(text)
    if text and not text.startswith('"'):
        return None, False
    return text.strip('"'), True


def _line_indent_and_content(line: str) -> tuple[int, str] | None:
    expanded = line.expandtabs(4)
    m = re.match(r'^(\s*)(.*)$', expanded)
    if not m or not m.group(2).strip():
        return None
    return len(m.group(1)), m.group(2)


def _looks_like_posting_content(content: str) -> bool:
    return POSTING_AMOUNT_RE.match(content.strip()) is not None


def _match_transaction_metadata(line: str) -> tuple[str, str] | None:
    """Transaction metadata: 2-space arbitrary string keys; 4+ indent for legacy known keys."""
    parsed = _line_indent_and_content(line)
    if not parsed:
        return None
    indent, content = parsed
    if indent < 2 or ":" not in content:
        return None
    if _looks_like_posting_content(content):
        return None
    colon = content.index(":")
    key = content[:colon].strip()
    value_text = content[colon + 1:]
    if not key:
        return None
    if indent >= 4:
        if key not in KNOWN_TXN_META_KEYS:
            return None
        return key, value_text
    value_stripped = value_text.strip()
    if not value_stripped:
        return key, value_text
    if value_stripped.startswith('"'):
        _, ok = _parse_metadata_value(value_text)
        if ok:
            return key, value_text
        return None
    if key in KNOWN_TXN_META_KEYS:
        return key, value_text
    return None


def _is_blocked_metadata_account(account: str) -> bool:
    base = (account or "").strip().rstrip(":")
    return base in KNOWN_TXN_META_KEYS or base.startswith("bkeasy-type")


def _finalize_transaction(
    txn: Transaction,
    entry_type: str | None,
    items: list[LedgerItem],
) -> None:
    if entry_type is None:
        txn.type = infer_type_from_postings(txn.postings)
    else:
        txn.type = entry_type if entry_type in ("expense", "income", "transfer", "") else entry_type
    items.append(txn)


def parse_file(path: Path, source_file: str | None = None) -> ParseResult:
    if source_file is None:
        source_file = path.relative_to(DATA_DIR).as_posix()
    result = ParseResult()
    current: Transaction | None = None
    entry_type: str | None = None

    with path.open(encoding="utf-8") as f:
        for line_no, raw in enumerate(f, start=1):
            line = raw.rstrip("\n\r")
            stripped = line.strip()
            if not stripped or stripped.startswith(";"):
                continue

            if UNSUPPORTED_UNDATED_RE.match(stripped):
                result.diagnostics.append(
                    _diag_line(line_no, f"不支持的指令 {stripped.split()[0]}", stripped)
                )
                continue

            pad_m = PAD_RE.match(line)
            if pad_m:
                if current is not None:
                    _finalize_transaction(current, entry_type, result.items)
                    current = None
                    entry_type = None
                result.items.append(
                    Pad(
                        id=f"{source_file}:{line_no}",
                        source_file=source_file,
                        source_line=line_no,
                        date=pad_m.group(1),
                        account=pad_m.group(2),
                        source_account=pad_m.group(3),
                    )
                )
                continue

            bal_m = BALANCE_RE.match(line)
            if bal_m:
                if current is not None:
                    _finalize_transaction(current, entry_type, result.items)
                    current = None
                    entry_type = None
                result.items.append(
                    Balance(
                        id=f"{source_file}:{line_no}",
                        source_file=source_file,
                        source_line=line_no,
                        date=bal_m.group(1),
                        account=bal_m.group(2),
                        amount=decimal_str(bal_m.group(3)),
                        currency=bal_m.group(4),
                    )
                )
                continue

            unsup_m = UNSUPPORTED_DATED_RE.match(line)
            if unsup_m:
                if current is not None:
                    _finalize_transaction(current, entry_type, result.items)
                    current = None
                    entry_type = None
                result.diagnostics.append(
                    _diag_line(line_no, f"不支持的指令 {unsup_m.group(2)}", stripped)
                )
                continue

            hm = _parse_transaction_header(line)
            if hm:
                if current is not None:
                    _finalize_transaction(current, entry_type, result.items)
                txn_date, flag, payee, remark, tags_raw = hm
                tags = []
                if tags_raw:
                    for token in tags_raw.split():
                        token = token.strip()
                        if TAG_TOKEN_RE.fullmatch(token):
                            tags.append(token[1:])
                        elif token.startswith("^"):
                            result.diagnostics.append(
                                _diag_line(line_no, "不支持 links", stripped)
                            )
                        else:
                            # Never reinterpret an unsupported header suffix as
                            # a tag: candidate rendering would otherwise turn it
                            # into a different, valid ledger record.
                            result.diagnostics.append(
                                _diag_line(line_no, "交易行尾仅支持 #tag", stripped)
                            )
                current = Transaction(
                    id=f"{source_file}:{line_no}",
                    source_file=source_file,
                    source_line=line_no,
                    date=txn_date,
                    flag=flag,
                    payee=payee,
                    remark=remark,
                    tags=tags,
                    postings=[],
                    metadata=[],
                    type="",
                )
                entry_type = None
                continue

            if current is not None:
                pf = POSTING_FLAG_RE.match(line)
                if pf:
                    result.diagnostics.append(
                        _diag_line(line_no, "不支持 posting flag", stripped)
                    )
                    continue

                meta_pair = _match_transaction_metadata(line)
                if meta_pair:
                    key, value_text = meta_pair
                    parsed_val, ok = _parse_metadata_value(value_text)
                    if not ok:
                        result.diagnostics.append(
                            _diag_line(line_no, "metadata 须为字符串", stripped)
                        )
                        continue
                    if key == "bkeasy-type":
                        entry_type = parsed_val or ""
                    elif key == "orbita-id" and parsed_val and is_valid_orbita_id(parsed_val):
                        current.id = parsed_val
                    current.metadata.append(MetadataEntry(key=key, value=parsed_val or ""))
                    continue

                pm = POSTING_RE.match(line)
                if pm:
                    account = pm.group(1).strip()
                    if _is_blocked_metadata_account(account):
                        result.diagnostics.append(
                            _diag_line(line_no, "metadata 不得解析为 posting", stripped)
                        )
                        continue
                    tail = pm.group(2)
                    (
                        amount,
                        currency,
                        price_amount,
                        price_currency,
                        cost_amount,
                        cost_currency,
                        lot_amount,
                        lot_currency,
                        lot_date,
                    ) = _parse_posting_tail(tail)
                    current.postings.append(
                        Posting(
                            account=pm.group(1),
                            amount=amount,
                            currency=currency,
                            price_amount=price_amount,
                            price_currency=price_currency,
                            cost_amount=cost_amount,
                            cost_currency=cost_currency,
                            lot_amount=lot_amount,
                            lot_currency=lot_currency,
                            lot_date=lot_date,
                        )
                    )
                    continue

                if POSTING_META_RE.match(line):
                    meta_m = re.match(r"^\s{4,}([^:]+):\s*(.+)\s*$", line)
                    if meta_m:
                        result.diagnostics.append(
                            _diag_line(line_no, "不支持 posting metadata", stripped)
                        )
                        continue

                result.diagnostics.append(
                    _diag_line(line_no, "无法识别的行", stripped)
                )
                continue

            result.diagnostics.append(
                _diag_line(line_no, "无法识别的行", stripped)
            )

    if current is not None:
        _finalize_transaction(current, entry_type, result.items)

    return result


def assign_initial_seq(items: list[LedgerItem]) -> None:
    counters: dict[str, int] = {}
    for item in items:
        idx = counters.get(item.date, 0)
        item.seq = f"a{idx}"
        counters[item.date] = idx + 1


def sort_for_display(items: list[LedgerItem]) -> list[LedgerItem]:
    def key(item: LedgerItem) -> tuple:
        try:
            date_key = -date.fromisoformat(item.date).toordinal()
        except ValueError:
            date_key = 0
        if isinstance(item, Transaction):
            valid_time = extract_valid_txn_time(item)
            if valid_time is not None:
                time_bucket = 0
                time_minutes = valid_time
            else:
                time_bucket = 1
                time_minutes = 0
        else:
            time_bucket = 1
            time_minutes = 0
        return (
            date_key,
            time_bucket,
            time_minutes,
            seq_numeric(item.seq, item.source_line),
            item.source_line,
        )

    return sorted(items, key=key)


_parse_cache: dict[str, tuple[float, ParseResult]] = {}


def invalidate_parse_cache() -> None:
    _parse_cache.clear()


def _load_write_target(path: Path, write_target: str) -> ParseResult:
    key = str(path.resolve())
    mtime = path.stat().st_mtime
    cached = _parse_cache.get(key)
    if cached and cached[0] == mtime:
        return cached[1]
    parsed = parse_file(path, write_target)
    assign_initial_seq(parsed.items)
    parsed.items = sort_for_display(parsed.items)
    _parse_cache[key] = (mtime, parsed)
    return parsed


def parse_write_target() -> ParseResult:
    write_target = get_write_target()
    path = DATA_DIR / write_target
    if not path.is_file():
        return ParseResult()
    return _load_write_target(path, write_target)

from dataclasses import dataclass

from ledger.services.ledger_item import (
    Balance,
    LedgerItem,
    MetadataEntry,
    Pad,
    Posting,
    Transaction,
    assign_orbita_id,
    ledger_sort_key,
)
from ledger.services.parser import encode_beancount_string


@dataclass
class CandidateItemRange:
    item_id: str
    start_line: int
    end_line: int


def _format_amount(text: str) -> str:
    value = float(text)
    sign = "-" if value < 0 else ""
    return f"{sign}{abs(value):.2f}"


def _tags_header(tags: list[str]) -> str:
    if not tags:
        return ""
    return " " + " ".join(f"#{t.lstrip('#')}" for t in tags)


def _ordered_metadata(txn: Transaction) -> list[MetadataEntry]:
    ordered: list[MetadataEntry] = []
    skip_bkeasy_in_meta = bool((txn.type or "").strip())
    if skip_bkeasy_in_meta:
        ordered.append(MetadataEntry(key="bkeasy-type", value=txn.type))
    for meta in txn.metadata:
        key = (meta.key or "").strip()
        if not key:
            continue
        if key == "bkeasy-type" and skip_bkeasy_in_meta:
            continue
        ordered.append(MetadataEntry(key=key, value=meta.value))
    return ordered


def _ensure_orbita_ids(items: list[LedgerItem]) -> None:
    for item in items:
        if not isinstance(item, Transaction):
            continue
        assign_orbita_id(item)
        has_meta = any(m.key == "orbita-id" for m in item.metadata)
        if not has_meta:
            item.metadata.append(MetadataEntry(key="orbita-id", value=item.id))


def _render_cost_suffix(p: Posting) -> str:
    if p.cost_amount is not None and (p.cost_currency or "").strip():
        return f" @@ {_format_amount(p.cost_amount)} {p.cost_currency.strip()}"
    if p.price_amount is not None and (p.price_currency or "").strip():
        return f" @ {_format_amount(p.price_amount)} {p.price_currency.strip()}"
    if p.lot_amount is not None and (p.lot_currency or "").strip():
        date_part = f", {p.lot_date}" if (p.lot_date or "").strip() else ""
        return f" {{{_format_amount(p.lot_amount)} {p.lot_currency.strip()}{date_part}}}"
    return ""


def _render_posting_line(p: Posting) -> str:
    if p.amount is None:
        return f"    {p.account}"
    line = f"    {p.account:<30} {_format_amount(p.amount)} {(p.currency or 'CNY').strip()}"
    line += _render_cost_suffix(p)
    return line


def render_transaction(txn: Transaction) -> str:
    header = (
        f"{txn.date} {(txn.flag or '*').strip()} "
        f"{encode_beancount_string(txn.payee or '')} "
        f"{encode_beancount_string(txn.remark or '')}"
        f"{_tags_header(txn.tags)}"
    )
    lines = [header]
    for p in txn.postings:
        lines.append(_render_posting_line(p))
    for meta in _ordered_metadata(txn):
        lines.append(f"  {meta.key}: {encode_beancount_string(meta.value)}")
    return "\n".join(lines)


def render_pad(pad: Pad) -> str:
    return f"{pad.date} pad {pad.account} {pad.source_account}"


def render_balance(bal: Balance) -> str:
    return f"{bal.date} balance {bal.account}  {_format_amount(bal.amount)} {bal.currency.strip()}"


def render_item(item: LedgerItem) -> str:
    if isinstance(item, Transaction):
        return render_transaction(item)
    if isinstance(item, Pad):
        return render_pad(item)
    if isinstance(item, Balance):
        return render_balance(item)
    raise ValueError(f"unsupported item kind: {getattr(item, 'kind', type(item))}")


def _item_id(item: LedgerItem) -> str:
    return item.id or f"{item.source_file}:{item.source_line}"


def render_ledger_candidate(
    items: list[LedgerItem],
    *,
    assign_ids: bool = True,
) -> tuple[str, list[CandidateItemRange]]:
    active = list(items)
    if assign_ids:
        _ensure_orbita_ids(active)
    active.sort(key=ledger_sort_key)
    if not active:
        return "", []

    ranges: list[CandidateItemRange] = []
    blocks: list[str] = []
    line_no = 1
    for item in active:
        block = render_item(item)
        block_lines = block.split("\n")
        start = line_no
        end = line_no + len(block_lines) - 1
        ranges.append(CandidateItemRange(item_id=_item_id(item), start_line=start, end_line=end))
        blocks.append(block)
        line_no = end + 2
    return "\n\n".join(blocks) + "\n", ranges


def render_ledger_file(items: list[LedgerItem], *, assign_ids: bool = True) -> str:
    text, _ = render_ledger_candidate(items, assign_ids=assign_ids)
    return text

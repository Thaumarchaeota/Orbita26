import hashlib
import os
import re
import time
from dataclasses import dataclass, field
from typing import Literal

ORBITA_ID_RE = re.compile(r"^txn_[0-9A-HJKMNP-TV-Z]{26}$")
LEGACY_ID_RE = re.compile(r"^.+:\d+$")
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

TransactionType = Literal["expense", "income", "transfer", ""]
ItemKind = Literal["transaction", "pad", "balance"]


@dataclass
class MetadataEntry:
    key: str
    value: str


@dataclass
class Posting:
    account: str
    amount: str | None
    currency: str
    price_amount: str | None = None
    price_currency: str | None = None
    cost_amount: str | None = None
    cost_currency: str | None = None
    lot_amount: str | None = None
    lot_currency: str | None = None
    lot_date: str | None = None


@dataclass
class Transaction:
    kind: Literal["transaction"] = "transaction"
    id: str = ""
    source_file: str = ""
    source_line: int = 0
    date: str = ""
    flag: str = "*"
    payee: str = ""
    remark: str = ""
    tags: list[str] = field(default_factory=list)
    postings: list[Posting] = field(default_factory=list)
    metadata: list[MetadataEntry] = field(default_factory=list)
    type: TransactionType = ""
    seq: str = ""


@dataclass
class Pad:
    kind: Literal["pad"] = "pad"
    id: str = ""
    source_file: str = ""
    source_line: int = 0
    date: str = ""
    account: str = ""
    source_account: str = ""
    seq: str = ""


@dataclass
class Balance:
    kind: Literal["balance"] = "balance"
    id: str = ""
    source_file: str = ""
    source_line: int = 0
    date: str = ""
    account: str = ""
    amount: str = ""
    currency: str = ""
    seq: str = ""


LedgerItem = Transaction | Pad | Balance


def _encode_ulid(data: bytes) -> str:
    if len(data) != 16:
        raise ValueError("ULID requires 16 bytes")
    n = int.from_bytes(data, "big")
    chars = [_CROCKFORD[n >> (5 * i) & 31] for i in range(25, -1, -1)]
    return "".join(chars)


def stable_orbita_id(seed: str) -> str:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return f"txn_{_encode_ulid(digest[:16])}"


def assign_orbita_id(txn: Transaction) -> None:
    if is_valid_orbita_id(txn.id):
        return
    seed = txn.id or f"{txn.source_file}:{txn.source_line}"
    txn.id = stable_orbita_id(seed)


def normalized_identity(txn: Transaction) -> dict | None:
    old_id = (txn.id or "").strip()
    if not old_id:
        old_id = f"{txn.source_file}:{txn.source_line}"
    if is_valid_orbita_id(old_id) or not is_session_id(old_id):
        return None
    new_id = stable_orbita_id(old_id)
    metadata: list[MetadataEntry] = []
    has_orbita = False
    for m in txn.metadata:
        if m.key == "orbita-id":
            has_orbita = True
            metadata.append(MetadataEntry(key="orbita-id", value=new_id))
        else:
            metadata.append(MetadataEntry(key=m.key, value=m.value))
    if not has_orbita:
        metadata.append(MetadataEntry(key="orbita-id", value=new_id))
    return {
        "from_id": old_id,
        "id": new_id,
        "metadata": [{"key": m.key, "value": m.value} for m in metadata],
    }


def collect_identity_backfill(items: list[LedgerItem]) -> list[dict]:
    out: list[dict] = []
    for item in items:
        if not isinstance(item, Transaction):
            continue
        norm = normalized_identity(item)
        if norm:
            out.append(norm)
    return out


def new_orbita_id() -> str:
    ts_ms = int(time.time() * 1000)
    return f"txn_{_encode_ulid(ts_ms.to_bytes(6, 'big') + os.urandom(10))}"


def decimal_str(value: float | str | int | None) -> str:
    if value is None:
        return "0.00"
    if isinstance(value, str):
        text = value.strip()
        return text if text else "0.00"
    return f"{float(value):.2f}"


def _normalize_tags(raw: list[str] | str | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        parts = []
        for token in text.split():
            token = token.strip()
            if token.startswith("#"):
                token = token[1:]
            if token:
                parts.append(token)
        return parts
    return [t.strip().lstrip("#") for t in raw if (t or "").strip()]


def _metadata_from_dict(raw: list | None) -> list[MetadataEntry]:
    out: list[MetadataEntry] = []
    for item in raw or []:
        if isinstance(item, dict):
            key = (item.get("key") or "").strip()
            if key:
                out.append(MetadataEntry(key=key, value=str(item.get("value", ""))))
    return out


def _posting_from_dict(p: dict) -> Posting:
    raw_amount = p.get("amount")
    if raw_amount is None:
        amount: str | None = None
        currency = (p.get("currency") or "").strip()
    else:
        amount = decimal_str(raw_amount)
        currency = (p.get("currency") or "").strip() or "CNY"
    return Posting(
        account=(p.get("account") or "").strip(),
        amount=amount,
        currency=currency,
        price_amount=decimal_str(p.get("price_amount")) if p.get("price_amount") is not None else None,
        price_currency=(p.get("price_currency") or "").strip() or None,
        cost_amount=decimal_str(p.get("cost_amount")) if p.get("cost_amount") is not None else None,
        cost_currency=(p.get("cost_currency") or "").strip() or None,
        lot_amount=decimal_str(p.get("lot_amount")) if p.get("lot_amount") is not None else None,
        lot_currency=(p.get("lot_currency") or "").strip() or None,
        lot_date=(p.get("lot_date") or "").strip() or None,
    )


def item_from_dict(d: dict) -> LedgerItem:
    kind = (d.get("kind") or "transaction").strip().lower()
    if kind == "pad":
        return Pad(
            id=d.get("id", "") or "",
            source_file=d.get("source_file", "") or "",
            source_line=int(d.get("source_line", 0) or 0),
            date=d.get("date", "") or "",
            account=(d.get("account") or "").strip(),
            source_account=(d.get("source_account") or "").strip(),
            seq=(d.get("seq") or "").strip(),
        )
    if kind == "balance":
        return Balance(
            id=d.get("id", "") or "",
            source_file=d.get("source_file", "") or "",
            source_line=int(d.get("source_line", 0) or 0),
            date=d.get("date", "") or "",
            account=(d.get("account") or "").strip(),
            amount=decimal_str(d.get("amount", 0)),
            currency=(d.get("currency") or "").strip() or "CNY",
            seq=(d.get("seq") or "").strip(),
        )

    metadata = _metadata_from_dict(d.get("metadata"))
    txn_type = (d.get("type") or "").strip()
    for m in metadata:
        if m.key == "bkeasy-type" and not txn_type:
            txn_type = m.value
    return Transaction(
        id=d.get("id", "") or "",
        source_file=d.get("source_file", "") or "",
        source_line=int(d.get("source_line", 0) or 0),
        date=d.get("date", "") or "",
        flag=(d.get("flag") or "*").strip() or "*",
        payee=d.get("payee", "") or "",
        remark=d.get("remark", "") or "",
        tags=_normalize_tags(d.get("tags")),
        postings=[_posting_from_dict(p) for p in (d.get("postings") or [])],
        metadata=metadata,
        type=txn_type if txn_type in ("expense", "income", "transfer", "") else txn_type,
        seq=(d.get("seq") or "").strip(),
    )


def is_session_id(item_id: str) -> bool:
    if not item_id:
        return True
    if item_id.startswith("new:"):
        return True
    return bool(LEGACY_ID_RE.match(item_id))


def is_valid_orbita_id(item_id: str) -> bool:
    return bool(ORBITA_ID_RE.match(item_id))


def active_items(items: list[dict]) -> list[dict]:
    return [d for d in items if not d.get("_deleted")]


VALID_TXN_TIME_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00\+08:00$"
)


def seq_numeric(seq: str, source_line: int) -> int:
    m = re.match(r"^a(\d+)$", (seq or "").strip())
    return int(m.group(1)) if m else source_line


def _safe_date_ordinal(date_str: str) -> int:
    from datetime import date

    try:
        return date.fromisoformat(date_str).toordinal()
    except ValueError:
        return 0


def extract_valid_txn_time(txn: Transaction) -> int | None:
    time_entries = [m for m in txn.metadata if m.key == "time"]
    if len(time_entries) != 1:
        return None
    value = (time_entries[0].value or "").strip()
    match = VALID_TXN_TIME_RE.match(value)
    if not match:
        return None
    if match.group(1) != txn.date:
        return None
    hour = int(match.group(2))
    minute = int(match.group(3))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def _ledger_time_sort_parts(item: LedgerItem) -> tuple[int, int]:
    if isinstance(item, Transaction):
        valid_time = extract_valid_txn_time(item)
        if valid_time is not None:
            return 0, valid_time
    return 1, 0


def ledger_sort_key(item: LedgerItem) -> tuple:
    time_bucket, time_minutes = _ledger_time_sort_parts(item)
    return (
        _safe_date_ordinal(item.date),
        time_bucket,
        time_minutes,
        seq_numeric(item.seq, item.source_line),
        item.source_line,
    )


def tags_to_api_string(tags: list[str]) -> str:
    parts = []
    for t in tags:
        text = (t or "").strip().lstrip("#")
        if text:
            parts.append(f"#{text}")
    return " ".join(parts)


def _posting_to_dict(p: Posting) -> dict:
    if p.amount is None:
        out: dict = {
            "account": p.account,
            "amount": None,
            "currency": (p.currency or "").strip(),
        }
    else:
        out = {
            "account": p.account,
            "amount": float(p.amount),
            "currency": (p.currency or "").strip() or "CNY",
        }
    if p.price_amount is not None:
        out["price_amount"] = float(p.price_amount)
        out["price_currency"] = (p.price_currency or "").strip()
    if p.cost_amount is not None:
        out["cost_amount"] = float(p.cost_amount)
        out["cost_currency"] = (p.cost_currency or "").strip()
    if p.lot_amount is not None:
        out["lot_amount"] = float(p.lot_amount)
        out["lot_currency"] = (p.lot_currency or "").strip()
        if p.lot_date:
            out["lot_date"] = p.lot_date
    return out


def item_to_dict(item: LedgerItem) -> dict:
    if isinstance(item, Pad):
        return {
            "kind": "pad",
            "id": item.id,
            "source_file": item.source_file,
            "source_line": item.source_line,
            "date": item.date,
            "account": item.account,
            "source_account": item.source_account,
            "seq": item.seq,
        }
    if isinstance(item, Balance):
        return {
            "kind": "balance",
            "id": item.id,
            "source_file": item.source_file,
            "source_line": item.source_line,
            "date": item.date,
            "account": item.account,
            "amount": item.amount,
            "currency": item.currency,
            "seq": item.seq,
        }
    return {
        "kind": "transaction",
        "id": item.id,
        "source_file": item.source_file,
        "source_line": item.source_line,
        "type": item.type,
        "date": item.date,
        "flag": item.flag,
        "payee": item.payee,
        "remark": item.remark,
        "tags": tags_to_api_string(item.tags),
        "postings": [_posting_to_dict(p) for p in item.postings],
        "metadata": [{"key": m.key, "value": m.value} for m in item.metadata],
        "seq": item.seq,
    }

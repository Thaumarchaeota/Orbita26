from datetime import datetime

from ledger.services.candidate import CandidateDiagnostic
from ledger.services.ledger_item import (
    Balance,
    LedgerItem,
    Pad,
    Transaction,
    is_session_id,
    is_valid_orbita_id,
    item_from_dict,
    ledger_sort_key,
)
from ledger.services.parser import is_valid_metadata_key

from ledger.services.settings import get_write_target

ORBITA_UNIQUE_META_KEYS = frozenset({"time", "orbita-id", "bkeasy-type"})


def _root(account: str) -> str:
    return (account or "").split(":", 1)[0]


def _parse_amount(text: str) -> float:
    return float(text)


def _validate_date(item_id: str, value: str) -> CandidateDiagnostic | None:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return CandidateDiagnostic(message="日期格式须为 YYYY-MM-DD", item_ids=[item_id])
    return None


ALLOWED_TXN_TYPES = frozenset({"expense", "income", "transfer", ""})


def _validate_transaction_metadata(txn: Transaction) -> list[CandidateDiagnostic]:
    diags: list[CandidateDiagnostic] = []
    iid = txn.id or f"{txn.source_file}:{txn.source_line}"
    key_counts: dict[str, int] = {}
    for meta in txn.metadata:
        key = (meta.key or "").strip()
        if not key:
            diags.append(CandidateDiagnostic(message="metadata key 不能为空", item_ids=[iid]))
            continue
        if not is_valid_metadata_key(key):
            diags.append(
                CandidateDiagnostic(message=f"metadata key 无效: {key}", item_ids=[iid])
            )
        if key in ORBITA_UNIQUE_META_KEYS:
            key_counts[key] = key_counts.get(key, 0) + 1
    for key, count in key_counts.items():
        if count > 1:
            diags.append(
                CandidateDiagnostic(message=f"metadata {key} 重复", item_ids=[iid])
            )
    return diags


def _validate_write_target(item_id: str, source_file: str) -> CandidateDiagnostic | None:
    expected = get_write_target()
    if source_file != expected:
        return CandidateDiagnostic(
            message=f"目标文件应为 {expected}",
            item_ids=[item_id],
        )
    return None


def _validate_transaction(txn: Transaction) -> list[CandidateDiagnostic]:
    diags: list[CandidateDiagnostic] = []
    iid = txn.id or f"{txn.source_file}:{txn.source_line}"

    if txn.type == "inv":
        diags.append(CandidateDiagnostic(message="类型 inv 不受支持", item_ids=[iid]))
    elif txn.type not in ALLOWED_TXN_TYPES:
        diags.append(CandidateDiagnostic(message="类型无效", item_ids=[iid]))

    if err := _validate_date(iid, txn.date):
        diags.append(err)
    if err := _validate_write_target(iid, txn.source_file):
        diags.append(err)

    diags.extend(_validate_transaction_metadata(txn))

    if not (txn.flag or "").strip():
        diags.append(CandidateDiagnostic(message="Flag 不能为空", item_ids=[iid]))

    if len(txn.postings) < 2:
        diags.append(CandidateDiagnostic(message="至少需要 2 条分录", item_ids=[iid]))
        return diags

    for i, p in enumerate(txn.postings):
        if not (p.account or "").strip():
            diags.append(
                CandidateDiagnostic(message=f"分录 {i + 1} 账户不能为空", item_ids=[iid])
            )
        if p.amount is None:
            continue
        try:
            _parse_amount(p.amount)
        except ValueError:
            diags.append(
                CandidateDiagnostic(message=f"分录 {i + 1} 金额无效", item_ids=[iid])
            )
            continue
    return diags


def _validate_pad(pad: Pad) -> list[CandidateDiagnostic]:
    iid = pad.id or f"{pad.source_file}:{pad.source_line}"
    diags: list[CandidateDiagnostic] = []
    if err := _validate_date(iid, pad.date):
        diags.append(err)
    if err := _validate_write_target(iid, pad.source_file):
        diags.append(err)
    if _root(pad.account) not in ("Assets", "Liabilities"):
        diags.append(
            CandidateDiagnostic(message="Pad 账户须为 Assets 或 Liabilities", item_ids=[iid])
        )
    if _root(pad.source_account) != "Equity":
        diags.append(
            CandidateDiagnostic(message="Pad 来源账户须为 Equity", item_ids=[iid])
        )
    if not (pad.account or "").strip():
        diags.append(CandidateDiagnostic(message="Pad 账户不能为空", item_ids=[iid]))
    if not (pad.source_account or "").strip():
        diags.append(
            CandidateDiagnostic(message="Pad 来源账户不能为空", item_ids=[iid])
        )
    return diags


def _validate_balance(bal: Balance) -> list[CandidateDiagnostic]:
    iid = bal.id or f"{bal.source_file}:{bal.source_line}"
    diags: list[CandidateDiagnostic] = []
    if err := _validate_date(iid, bal.date):
        diags.append(err)
    if err := _validate_write_target(iid, bal.source_file):
        diags.append(err)
    if _root(bal.account) not in ("Assets", "Liabilities"):
        diags.append(
            CandidateDiagnostic(
                message="Balance 账户须为 Assets 或 Liabilities",
                item_ids=[iid],
            )
        )
    if not (bal.account or "").strip():
        diags.append(CandidateDiagnostic(message="Balance 账户不能为空", item_ids=[iid]))
    try:
        _parse_amount(bal.amount)
    except ValueError:
        diags.append(CandidateDiagnostic(message="Balance 金额无效", item_ids=[iid]))
    if not (bal.currency or "").strip():
        diags.append(CandidateDiagnostic(message="Balance 币种不能为空", item_ids=[iid]))
    return diags


def _validate_identity(items: list[LedgerItem]) -> list[CandidateDiagnostic]:
    diags: list[CandidateDiagnostic] = []
    seen_orbita: dict[str, str] = {}

    for item in items:
        item_id = item.id or f"{item.source_file}:{item.source_line}"
        if not item_id:
            continue
        if not isinstance(item, Transaction):
            continue
        if is_valid_orbita_id(item_id):
            prev = seen_orbita.get(item_id)
            if prev:
                diags.append(
                    CandidateDiagnostic(
                        message="orbita-id 重复",
                        item_ids=[item_id, prev],
                    )
                )
            else:
                seen_orbita[item_id] = item_id
            continue
        if is_session_id(item_id):
            continue
        diags.append(
            CandidateDiagnostic(message="条目 ID 格式无效", item_ids=[item_id])
        )

    return diags


def validate_ledger_items(raw_items: list[dict]) -> tuple[list[LedgerItem], list[CandidateDiagnostic]]:
    diags: list[CandidateDiagnostic] = []
    parsed: list[LedgerItem] = []

    for raw in raw_items:
        kind = (raw.get("kind") or "transaction").strip().lower()
        if kind not in ("transaction", "pad", "balance"):
            item_id = raw.get("id", "") or ""
            diags.append(
                CandidateDiagnostic(
                    message=f"不支持的条目类型: {kind}",
                    item_ids=[item_id] if item_id else [],
                )
            )
            continue
        item = item_from_dict(raw)
        parsed.append(item)
        if isinstance(item, Transaction):
            diags.extend(_validate_transaction(item))
        elif isinstance(item, Pad):
            diags.extend(_validate_pad(item))
        elif isinstance(item, Balance):
            diags.extend(_validate_balance(item))

    diags.extend(_validate_identity(parsed))
    if not diags:
        parsed.sort(key=ledger_sort_key)
    return parsed, diags

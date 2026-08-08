from datetime import datetime

from ledger.services.models import Entry, Posting
from ledger.services.settings import get_write_target

ALLOWED_TYPES = frozenset({"expense", "income", "transfer", "inv"})
EPSILON = 0.001


class ValidationError(Exception):
    def __init__(self, entry_id: str, field: str, message: str):
        self.entry_id = entry_id
        self.field = field
        self.message = message
        super().__init__(message)


def _posting_currency(p: Posting) -> str:
    return (p.currency or "").strip() or "CNY"


def _validate_balance(eid: str, postings: list) -> None:
    currencies = {_posting_currency(p) for p in postings}
    if len(currencies) <= 1:
        totals: dict[str, float] = {}
        for p in postings:
            cur = _posting_currency(p)
            totals[cur] = totals.get(cur, 0.0) + p.amount
        for cur, total in totals.items():
            if abs(total) > EPSILON:
                raise ValidationError(eid, "postings", f"分录未配平（{cur} 合计 {total:.2f}）")
        return

    has_cost = any(
        p.cost_amount is not None and abs(p.cost_amount) > EPSILON
        for p in postings
    )
    if not has_cost:
        raise ValidationError(eid, "postings", "跨币种须指定 @@ 成本")

    totals: dict[str, float] = {}
    cost_annotated: set[str] = set()
    for p in postings:
        cur = _posting_currency(p)
        totals[cur] = totals.get(cur, 0.0) + p.amount
        if p.cost_amount is not None and abs(p.cost_amount) > EPSILON:
            cc = (p.cost_currency or "").strip()
            if cc:
                totals[cc] = totals.get(cc, 0.0) + p.cost_amount
                cost_annotated.add(cur)

    for cur, total in totals.items():
        if cur in cost_annotated:
            continue
        if abs(total) > EPSILON:
            raise ValidationError(eid, "postings", f"分录未配平（{cur} 合计 {total:.2f}）")


def validate_entry(entry: Entry) -> None:
    eid = entry.id or ""

    if entry.type not in ALLOWED_TYPES:
        raise ValidationError(eid, "type", "类型无效")

    try:
        datetime.strptime(entry.date, "%Y-%m-%d")
    except ValueError:
        raise ValidationError(eid, "date", "日期格式须为 YYYY-MM-DD")

    if not (entry.flag or "").strip():
        raise ValidationError(eid, "flag", "Flag 不能为空")

    if len(entry.postings) < 2:
        raise ValidationError(eid, "postings", "至少需要 2 条分录")

    for i, p in enumerate(entry.postings):
        account = (p.account or "").strip()
        if not account:
            raise ValidationError(eid, f"postings[{i}].account", "账户不能为空")
        if p.amount == 0:
            raise ValidationError(eid, f"postings[{i}].amount", "金额不能为 0")

    _validate_balance(eid, entry.postings)

    expected = get_write_target()
    if entry.source_file != expected:
        raise ValidationError(eid, "source_file", f"目标文件应为 {expected}")


def validate_entries(entries: list[Entry]) -> list[dict]:
    errors: list[dict] = []
    for entry in entries:
        try:
            validate_entry(entry)
        except ValidationError as e:
            errors.append({
                "entry_id": e.entry_id,
                "field": e.field,
                "error": e.message,
            })
    return errors

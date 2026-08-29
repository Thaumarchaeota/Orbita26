import re

import tempfile

from dataclasses import dataclass

from datetime import date

from decimal import Decimal

from pathlib import Path



from ledger.config import DATA_DIR

from ledger.services.accounts import list_accounts

from ledger.services.settings import get_write_target



_INCLUDE_LINE_RE = re.compile(r'^\s*include\s+"([^"]+)"\s*(?:;.*)?$', re.MULTILINE)





@dataclass(frozen=True)

class CommittedPostingFact:

    entry_date: date

    entry_id: str

    account: str

    unit_amount: Decimal

    unit_currency: str

    total_cost_amount: Decimal | None = None

    total_cost_currency: str | None = None





class CommittedLedgerLoadError(Exception):

    def __init__(self, message: str):

        self.message = message

        super().__init__(message)





def _decimal_str(value: Decimal) -> str:

    s = format(value, "f")

    if "." in s:

        s = s.rstrip("0").rstrip(".")

    return s or "0"





def _parse_iso_date(value: str | None) -> date | None:

    if not value:

        return None

    try:

        return date.fromisoformat(value.strip())

    except ValueError:

        return None





def _account_kind(account: str) -> str:

    if account.startswith("Liabilities:"):

        return "liability"

    return "asset"





def _declared_asset_liability_accounts() -> set[str]:

    groups = list_accounts()

    names: set[str] = set()

    for key in ("assets", "liabilities"):

        for item in groups.get(key, []):

            names.add(item["name"])

    return names





def _resolve_include_path(base_file: Path, include_rel: str) -> Path:

    rel = include_rel.strip().replace("\\", "/")

    if not rel:

        raise CommittedLedgerLoadError(f"include 路径无效: {include_rel!r}")

    if rel.startswith("/") or ".." in Path(rel).parts:

        raise CommittedLedgerLoadError(f"include 越界: {include_rel}")

    candidate = (base_file.parent / rel).resolve()

    try:

        candidate.relative_to(DATA_DIR.resolve())

    except ValueError:

        raise CommittedLedgerLoadError(f"include 越界: {include_rel}")

    return candidate





def _gather_include_closure(entry: Path, seen: set[Path]) -> set[Path]:

    if entry in seen:

        return seen

    if not entry.is_file():

        raise CommittedLedgerLoadError(f"账本文件不存在或不可读: {entry.relative_to(DATA_DIR)}")

    seen.add(entry)

    try:

        text = entry.read_text(encoding="utf-8")

    except OSError as exc:

        raise CommittedLedgerLoadError(f"账本文件不可读: {entry.relative_to(DATA_DIR)} ({exc})") from exc

    for match in _INCLUDE_LINE_RE.finditer(text):

        included = _resolve_include_path(entry, match.group(1))

        _gather_include_closure(included, seen)

    return seen





def _copy_include_closure_to(tmp_root: Path, files: set[Path]) -> None:

    for src in files:

        rel = src.relative_to(DATA_DIR)

        dest = tmp_root / rel

        dest.parent.mkdir(parents=True, exist_ok=True)

        dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")





def validate_period_account(account: str) -> str | None:

    account = (account or "").strip()

    if not account:

        return "账户不能为空"

    if not (account.startswith("Assets:") or account.startswith("Liabilities:")):

        return "仅支持资产或负债账户"

    declared = _declared_asset_liability_accounts()

    if account not in declared:

        return "账户不存在"

    return None





def validate_period_dates(

    date_from: str | None,

    date_to: str | None,

) -> tuple[date | None, date | None, str | None]:

    has_from = bool(date_from and str(date_from).strip())

    has_to = bool(date_to and str(date_to).strip())

    if has_from != has_to:

        return None, None, "须同时提供开始和结束日期，或两者均省略"

    start = _parse_iso_date(date_from) if has_from else None

    end = _parse_iso_date(date_to) if has_to else None

    if has_from and start is None:

        return None, None, "日期格式无效"

    if has_to and end is None:

        return None, None, "日期格式无效"

    if start and end and start > end:

        return None, None, "开始日期不能晚于结束日期"

    return start, end, None





def load_committed_beancount() -> tuple[list, list, dict]:

    try:

        from beancount import loader

    except ImportError:

        raise CommittedLedgerLoadError("Beancount 未安装")



    write_target = get_write_target()

    ledger_path = DATA_DIR / write_target

    if not ledger_path.is_file():

        raise CommittedLedgerLoadError(f"写入目标不存在或不可读: {write_target}")



    closure: set[Path] = set()

    _gather_include_closure(ledger_path, closure)

    for name in ("account.bean", "category.bean"):

        sidecar = DATA_DIR / name

        if sidecar.is_file():

            closure.add(sidecar.resolve())



    with tempfile.TemporaryDirectory(prefix="orbita-stats-") as tmp:

        tmp_root = Path(tmp)

        _copy_include_closure_to(tmp_root, closure)

        includes = [

            f'include "{name}"'

            for name in ("account.bean", "category.bean")

            if (tmp_root / name).is_file()

        ]

        rel_target = write_target.replace("\\", "/")

        if (tmp_root / rel_target).is_file():

            includes.append(f'include "{rel_target}"')

        elif not includes:

            raise CommittedLedgerLoadError(f"写入目标不存在或不可读: {write_target}")

        main_bean = tmp_root / "main.bean"

        main_bean.write_text("\n".join(includes) + "\n", encoding="utf-8")

        entries, errors, options = loader.load_file(str(main_bean))

        return entries, errors, options





def _format_load_errors(errors: list, limit: int = 3) -> str:

    msgs = [getattr(err, "message", None) or str(err) for err in errors[:limit]]

    return "; ".join(msgs)





_POSTING_LINE_RE = re.compile(r"^\s{2,}(\S+)\s*(.*)$")

_TOTAL_COST_TOKEN_RE = re.compile(r"(?<![@])@@\s+(-?\d+(?:\.\d+)?)(?:\s+(\S+))?")





def _strip_beancount_comment(text: str) -> str:

    in_quote = False

    for i, char in enumerate(text):

        if char == '"':

            in_quote = not in_quote

        elif char == ";" and not in_quote:

            return text[:i].rstrip()

    return text





def _posting_amount_tail(line: str, account: str) -> str | None:

    match = _POSTING_LINE_RE.match(line)

    if not match or match.group(1) != account:

        return None

    return _strip_beancount_comment(match.group(2)).strip()





def _ledger_line_at_lineno(lineno: int, write_target: str | None = None) -> str | None:

    target = write_target or get_write_target()

    ledger_path = DATA_DIR / target

    if not ledger_path.is_file():

        return None

    lines = ledger_path.read_text(encoding="utf-8").splitlines()

    if lineno < 1 or lineno > len(lines):

        return None

    return lines[lineno - 1]





def _posting_has_total_cost(posting, write_target: str | None = None) -> bool:

    if posting.cost is not None:

        return False

    if posting.price is None:

        return False

    lineno = posting.meta.get("lineno")

    if not lineno:

        return False

    line = _ledger_line_at_lineno(lineno, write_target)

    if line is None:

        return False

    tail = _posting_amount_tail(line, posting.account)

    if not tail:

        return False

    return _TOTAL_COST_TOKEN_RE.search(tail) is not None





def _flow_amount_and_currency(fact: CommittedPostingFact) -> tuple[Decimal, str]:

    if fact.total_cost_amount is not None and fact.total_cost_currency is not None:

        return fact.total_cost_amount, fact.total_cost_currency

    return fact.unit_amount, fact.unit_currency





def iter_committed_posting_facts(entries: list, write_target: str | None = None) -> list[CommittedPostingFact]:

    from beancount.core import data

    from beancount.core.number import MISSING



    target = write_target or get_write_target()

    facts: list[CommittedPostingFact] = []



    for entry in entries:

        if not isinstance(entry, data.Transaction):

            continue

        entry_lineno = entry.meta.get("lineno", 0)

        entry_id = f"{target}:{entry_lineno}"

        for posting in entry.postings:

            units = posting.units

            if units is MISSING or units is None:

                continue

            total_cost_amount = None

            total_cost_currency = None

            if _posting_has_total_cost(posting, target):

                total_cost_amount = posting.price.number * units.number

                total_cost_currency = posting.price.currency

            facts.append(

                CommittedPostingFact(

                    entry_date=entry.date,

                    entry_id=entry_id,

                    account=posting.account,

                    unit_amount=units.number,

                    unit_currency=units.currency,

                    total_cost_amount=total_cost_amount,

                    total_cost_currency=total_cost_currency,

                )

            )

    return facts





def compute_account_period_stats(

    account: str,

    date_from: str | None = None,

    date_to: str | None = None,

) -> dict:

    from beancount.core import realization



    account = (account or "").strip()

    account_error = validate_period_account(account)

    if account_error:

        return {"ok": False, "error": account_error, "kind": "validation"}



    start, end, date_error = validate_period_dates(date_from, date_to)

    if date_error:

        return {"ok": False, "error": date_error, "kind": "validation"}



    try:

        entries, load_errors, _options = load_committed_beancount()

    except CommittedLedgerLoadError as exc:

        return {"ok": False, "error": exc.message, "kind": "ledger"}



    if load_errors:

        return {"ok": False, "error": _format_load_errors(load_errors), "kind": "ledger"}



    facts = iter_committed_posting_facts(entries)



    CurrencyBucket = dict[str, Decimal]

    opening: CurrencyBucket = {}

    inflows: CurrencyBucket = {}

    outflows: CurrencyBucket = {}

    period_change: CurrencyBucket = {}

    closing: CurrencyBucket = {}

    txn_ids_by_currency: dict[str, set[str]] = {}



    def add_amount(bucket: CurrencyBucket, currency: str, amount: Decimal) -> None:

        bucket[currency] = bucket.get(currency, Decimal("0")) + amount



    if start and end:

        for fact in facts:

            if fact.account != account:

                continue

            entry_date = fact.entry_date

            if entry_date < start:

                add_amount(opening, fact.unit_currency, fact.unit_amount)

            if entry_date <= end:

                add_amount(closing, fact.unit_currency, fact.unit_amount)

            if start <= entry_date <= end:

                flow_amount, flow_currency = _flow_amount_and_currency(fact)

                add_amount(period_change, flow_currency, flow_amount)

                if flow_amount > 0:

                    add_amount(inflows, flow_currency, flow_amount)

                elif flow_amount < 0:

                    add_amount(outflows, flow_currency, -flow_amount)

                txn_ids_by_currency.setdefault(flow_currency, set()).add(fact.entry_id)

    else:

        real = realization.realize(entries) if entries else None

        if real is not None:

            for node in realization.iter_children(real, leaf_only=True):

                if node.account != account:

                    continue

                for pos in node.balance:

                    currency = pos.units.currency

                    add_amount(closing, currency, pos.units.number)



    currencies = sorted(

        set(opening) | set(inflows) | set(outflows) | set(period_change) | set(closing)

    )



    def currency_rows(include_period: bool) -> list[dict]:

        rows: list[dict] = []

        for currency in currencies:

            if include_period:

                rows.append(

                    {

                        "currency": currency,

                        "opening_balance": _decimal_str(opening.get(currency, Decimal("0"))),

                        "inflows": _decimal_str(inflows.get(currency, Decimal("0"))),

                        "outflows": _decimal_str(outflows.get(currency, Decimal("0"))),

                        "net_change": _decimal_str(period_change.get(currency, Decimal("0"))),

                        "closing_balance": _decimal_str(closing.get(currency, Decimal("0"))),

                        "transaction_count": len(txn_ids_by_currency.get(currency, set())),

                    }

                )

            else:

                rows.append(

                    {

                        "currency": currency,

                        "balance": _decimal_str(closing.get(currency, Decimal("0"))),

                        "transaction_count": 0,

                    }

                )

        return rows



    result = {

        "ok": True,

        "account": account,

        "account_kind": _account_kind(account),

        "currencies": currency_rows(include_period=bool(start and end)),

    }

    if start:

        result["date_from"] = start.isoformat()

    if end:

        result["date_to"] = end.isoformat()

    return result



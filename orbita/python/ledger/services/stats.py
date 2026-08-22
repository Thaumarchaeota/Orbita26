import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

from ledger.config import DATA_DIR
from ledger.services.accounts import list_accounts
from ledger.services.settings import get_reporting_currency, get_write_target

AssertionStatus = str  # "pass" | "fail" | "none"


def _reporting_currency() -> str:
    # Settings is the single owner of this display-only statistics preference.
    return get_reporting_currency()


def _decimal_str(value: Decimal) -> str:
    s = format(value, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def _inventory_to_balances(inventory) -> list[dict]:
    if inventory is None or inventory.is_empty():
        return []
    out: list[dict] = []
    for pos in inventory:
        out.append(
            {
                "currency": pos.units.currency,
                "amount": _decimal_str(pos.units.number),
            }
        )
    return out


def _load_committed_beancount() -> tuple[list, list, dict]:
    try:
        from beancount import loader
    except ImportError:
        return [], [{"message": "Beancount 未安装"}], {}

    write_target = get_write_target()
    ledger_path = DATA_DIR / write_target
    if not ledger_path.is_file():
        return [], [], {}

    with tempfile.TemporaryDirectory(prefix="orbita-stats-") as tmp:
        tmp_root = Path(tmp)
        for name in ("account.bean", "category.bean"):
            src = DATA_DIR / name
            if src.is_file():
                (tmp_root / name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        rel_ledger = tmp_root / write_target
        rel_ledger.parent.mkdir(parents=True, exist_ok=True)
        rel_ledger.write_text(ledger_path.read_text(encoding="utf-8"), encoding="utf-8")
        includes = [
            f'include "{name}"' for name in ("account.bean", "category.bean") if (tmp_root / name).is_file()
        ] + [f'include "{write_target}"']
        main_bean = tmp_root / "main.bean"
        main_bean.write_text("\n".join(includes) + "\n", encoding="utf-8")
        entries, errors, options = loader.load_file(str(main_bean))
        return entries, errors, options


def _latest_balance_assertions(entries) -> dict[str, object]:
    from beancount.core import data

    latest: dict[str, data.Balance] = {}
    for entry in entries:
        if isinstance(entry, data.Balance):
            prev = latest.get(entry.account)
            if prev is None or entry.date > prev.date:
                latest[entry.account] = entry
    return latest


def _failed_assertion_keys(check_errors) -> set[tuple[str, date]]:
    keys: set[tuple[str, date]] = set()
    for err in check_errors:
        entry = getattr(err, "entry", None)
        if entry is not None and hasattr(entry, "account") and hasattr(entry, "date"):
            keys.add((entry.account, entry.date))
    return keys


def _collect_declared_asset_accounts() -> set[str]:
    groups = list_accounts()
    names: set[str] = set()
    for key in ("assets", "liabilities"):
        for item in groups.get(key, []):
            names.add(item["name"])
    return names


def compute_account_balances() -> dict:
    from beancount.core import data, realization
    from beancount.core.interpolate import BalanceError
    from beancount.ops import balance as bc_balance

    entries, load_errors, options = _load_committed_beancount()
    fatal_errors = [err for err in load_errors if not isinstance(err, BalanceError)]
    if fatal_errors:
        msgs = [getattr(err, "message", None) or str(err) for err in fatal_errors]
        return {"ok": False, "error": "; ".join(msgs), "accounts": []}

    if not entries:
        return {"ok": True, "accounts": [], "reporting_currency": _reporting_currency()}

    balance_load_errors = [err for err in load_errors if isinstance(err, BalanceError)]
    _, check_errors = bc_balance.check(entries, options)
    failed = _failed_assertion_keys(check_errors) | _failed_assertion_keys(balance_load_errors)
    latest_assertions = _latest_balance_assertions(entries)

    real = realization.realize(entries)
    balance_by_account: dict[str, list[dict]] = {}
    for node in realization.iter_children(real, leaf_only=True):
        acc = node.account
        if not (acc.startswith("Assets:") or acc.startswith("Liabilities:")):
            continue
        balances = _inventory_to_balances(node.balance)
        if balances:
            balance_by_account[acc] = balances

    declared = _collect_declared_asset_accounts()
    all_accounts = sorted(declared | set(balance_by_account) | set(latest_assertions))

    accounts: list[dict] = []
    for acc in all_accounts:
        assertion = latest_assertions.get(acc)
        if assertion is None:
            status: AssertionStatus = "none"
            assertion_date = None
        elif (acc, assertion.date) in failed:
            status = "fail"
            assertion_date = assertion.date.isoformat()
        else:
            status = "pass"
            assertion_date = assertion.date.isoformat()

        accounts.append(
            {
                "account": acc,
                "balances": balance_by_account.get(acc, []),
                "assertion_status": status,
                "assertion_date": assertion_date,
            }
        )

    return {
        "ok": True,
        "reporting_currency": _reporting_currency(),
        "accounts": accounts,
    }


def _posting_reporting_amount(posting, reporting: str) -> Decimal | None:
    units = posting.units
    if units.currency == reporting:
        return units.number
    cost = posting.cost
    if cost is not None and cost.currency == reporting and units.number != 0:
        return cost.number
    return None


def _compute_month_posting_stats(account_prefix: str, *, income: bool) -> dict:
    from beancount.core import data

    reporting = _reporting_currency()
    month_prefix = date.today().strftime("%Y-%m")
    entries, load_errors, _options = _load_committed_beancount()
    if load_errors:
        return {"month_total": 0.0, "by_category": []}

    total = Decimal("0")
    by_account: dict[str, Decimal] = {}

    for entry in entries:
        if not isinstance(entry, data.Transaction):
            continue
        if not entry.date.isoformat().startswith(month_prefix):
            continue
        has_reporting = any(
            p.account.startswith(account_prefix) and p.units.currency == reporting
            for p in entry.postings
        )
        for posting in entry.postings:
            if not posting.account.startswith(account_prefix):
                continue
            if has_reporting:
                if posting.units.currency != reporting:
                    continue
                amt = posting.units.number
            else:
                amt = _posting_reporting_amount(posting, reporting)
                if amt is None:
                    continue
            if income:
                if amt >= 0:
                    continue
                amt = -amt
            elif amt <= 0:
                continue
            total += amt
            by_account[posting.account] = by_account.get(posting.account, Decimal("0")) + amt

    categories = [
        {"account": acc, "total": float(v)}
        for acc, v in sorted(by_account.items(), key=lambda x: (-x[1], x[0]))
    ]
    return {
        "month_total": float(total),
        "by_category": categories[:10],
        "reporting_currency": reporting,
    }


def compute_month_expense_stats() -> dict:
    return _compute_month_posting_stats("Expenses:", income=False)


def compute_month_income_stats() -> dict:
    return _compute_month_posting_stats("Income:", income=True)


def get_stats() -> dict:
    balances = compute_account_balances()
    if not balances.get("ok"):
        return balances
    expenses = compute_month_expense_stats()
    income = compute_month_income_stats()
    return {
        "ok": True,
        "reporting_currency": balances["reporting_currency"],
        "accounts": balances["accounts"],
        "month_expenses_total": expenses["month_total"],
        "month_expenses_by_category": expenses["by_category"],
        "month_income_total": income["month_total"],
        "month_income_by_category": income["by_category"],
    }

from ledger.services.models import Entry


def _format_amount(amount: float) -> str:
    sign = "-" if amount < 0 else ""
    return f"{sign}{abs(amount):.2f}"


def _line(
    account: str,
    amount: float,
    currency: str = "CNY",
    cost_amount: float | None = None,
    cost_currency: str = "",
) -> str:
    cur = (currency or "").strip() or "CNY"
    line = f"    {account:<30} {_format_amount(amount)} {cur}"
    if cost_amount is not None and (cost_currency or "").strip():
        line += f" @@ {_format_amount(cost_amount)} {cost_currency.strip()}"
    return line


def _header(entry_date: str, flag: str, payee: str, remark: str, tags: str) -> str:
    flag = (flag or "").strip() or "*"
    payee = payee or ""
    remark = remark or ""
    line = f'{entry_date} {flag} "{payee}" "{remark}"'
    tags = (tags or "").strip()
    if tags:
        line += f" {tags}"
    return line


def render_entry(entry: Entry) -> str:
    lines = [_header(entry.date, entry.flag, entry.payee, entry.remark, entry.tags)]
    for p in entry.postings:
        lines.append(
            _line(p.account, p.amount, p.currency, p.cost_amount, p.cost_currency)
        )
    lines.append(f'    bkeasy-type: "{entry.type}"')
    return "\n".join(lines)


def render_file(entries: list[Entry]) -> str:
    if not entries:
        return ""
    blocks = [render_entry(e) for e in entries]
    return "\n\n".join(blocks) + "\n"

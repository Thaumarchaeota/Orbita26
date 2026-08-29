from ledger.config import ACCOUNT_FILE, CATEGORY_FILE
from ledger.services.open_line import OPEN_RE, group_for_name, parse_open_line

GROUP_KEYS = ("expenses", "income", "assets", "liabilities", "equity")


def _read_file_opens(path, source_file: str) -> list[dict]:
    if not path.is_file():
        return []
    items: list[dict] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        item = parse_open_line(line, source_file, line_no)
        if item is not None:
            items.append(item)
    return items


def list_accounts() -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {key: [] for key in GROUP_KEYS}
    for item in _read_file_opens(CATEGORY_FILE, "category.bean"):
        group = group_for_name(item["name"])
        if group:
            groups[group].append(item)
    for item in _read_file_opens(ACCOUNT_FILE, "account.bean"):
        group = group_for_name(item["name"])
        if group:
            groups[group].append(item)
    for key in groups:
        groups[key].sort(key=lambda x: x["name"])
    return groups


def all_accounts() -> list[str]:
    groups = list_accounts()
    merged: list[str] = []
    for key in GROUP_KEYS:
        merged.extend(item["name"] for item in groups[key])
    return sorted(set(merged))


def all_declared_account_names() -> list[str]:
    names: list[str] = []
    for path in (CATEGORY_FILE, ACCOUNT_FILE):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            m = OPEN_RE.match(line.strip())
            if m:
                names.append(m.group(2))
    return sorted(set(names))

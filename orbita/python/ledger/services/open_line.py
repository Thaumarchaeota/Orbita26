import re

OPEN_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})\s+open\s+(\S+)(?:\s+([^;]+))?(?:\s*;\s*(.*))?$"
)


def _split_brief(label_path: list[str]) -> tuple[list[str], str]:
    if not label_path:
        return [], ""
    path = list(label_path)
    last = path[-1]
    i = last.rfind("_")
    if i >= 0:
        brief = last[i + 1 :].strip()
        path[-1] = last[:i].strip()
    else:
        brief = ""
    return path, brief


def group_for_name(name: str) -> str | None:
    if name.startswith("Equity:"):
        return None
    if name.startswith("Expenses:"):
        return "expenses"
    if name.startswith("Income:"):
        return "income"
    if name.startswith("Assets:"):
        return "assets"
    if name.startswith("Liabilities:"):
        return "liabilities"
    return None


def parse_open_line(line: str, source_file: str, source_line: int) -> dict | None:
    m = OPEN_RE.match(line.strip())
    if not m:
        return None
    name = m.group(2)
    group = group_for_name(name)
    if group is None:
        return None
    open_date = m.group(1)
    extra = (m.group(3) or "").strip()
    raw_label = (m.group(4) or "").strip()
    label_path = [p.strip() for p in raw_label.split(":") if p.strip()] if raw_label else []
    label_path, brief = _split_brief(label_path)
    return {
        "name": name,
        "label": raw_label,
        "label_path": label_path,
        "brief": brief,
        "open_date": open_date,
        "extra": extra,
        "id": f"{source_file}:{source_line}",
        "source_file": source_file,
        "source_line": source_line,
    }


def render_open_line(open_date: str, name: str, extra: str = "", label: str = "") -> str:
    line = f"{open_date} open {name}"
    extra = (extra or "").strip()
    if extra:
        line += f" {extra}"
    label = (label or "").strip()
    if label:
        line += f" ;{label}"
    return line

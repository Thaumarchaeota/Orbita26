from ledger.config import CATEGORY_FILE
from ledger.services.io import atomic_write
from ledger.services.open_line import OPEN_RE, render_open_line


def _validate_category(cat: dict) -> None:
    name = (cat.get("name") or "").strip()
    if not name.startswith("Expenses:") and not name.startswith("Income:"):
        raise ValueError(f"无效分类账户: {name}")
    if cat.get("source_file") != "category.bean":
        raise ValueError(f"无效来源文件: {cat.get('source_file')}")
    source_line = int(cat.get("source_line") or 0)
    if source_line < 1:
        raise ValueError("无效行号")


def commit_categories(categories: list[dict]) -> None:
    if not CATEGORY_FILE.is_file():
        raise ValueError("category.bean 不存在")
    lines = CATEGORY_FILE.read_text(encoding="utf-8").splitlines(keepends=True)
    for cat in categories:
        _validate_category(cat)
        source_line = int(cat["source_line"])
        if source_line > len(lines):
            raise ValueError(f"行号超出范围: {source_line}")
        idx = source_line - 1
        current = lines[idx].rstrip("\n\r")
        if not OPEN_RE.match(current.strip()):
            raise ValueError(f"第 {source_line} 行不是 open 行")
        raw = lines[idx]
        if raw.endswith("\r\n"):
            nl = "\r\n"
        elif raw.endswith("\n"):
            nl = "\n"
        else:
            nl = ""
        lines[idx] = render_open_line(
            cat.get("open_date") or "2026-01-01",
            cat["name"].strip(),
            cat.get("extra") or "",
            cat.get("label") or "",
        ) + nl
    atomic_write(CATEGORY_FILE, "".join(lines))

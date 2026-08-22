from ledger.services.account_common import find_open_line
from ledger.services.account_delete_scan import scan_account_delete
from ledger.services.io import atomic_write


def delete_account(name: str) -> dict:
    scan = scan_account_delete(name)
    if not scan.get("exists"):
        raise ValueError("账户不存在")
    if not scan.get("can_delete"):
        if scan.get("references"):
            raise ValueError("账户仍被账本引用，无法删除")
        if scan.get("child_accounts"):
            raise ValueError("存在子账户，无法删除")
        raise ValueError("账户不可删除")

    found = find_open_line(name)
    if not found:
        raise ValueError("未找到账户 open 行")
    path, _source_file, source_line, _item = found
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    if source_line < 1 or source_line > len(lines):
        raise ValueError("open 行号无效")
    new_text = "".join(lines[: source_line - 1] + lines[source_line:])
    atomic_write(path, new_text)
    return {"ok": True, "account": name}

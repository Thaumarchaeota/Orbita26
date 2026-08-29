import tempfile
import uuid
from pathlib import Path

from ledger.config import ACCOUNT_FILE, CATEGORY_FILE, DATA_DIR
from ledger.services.account_common import (
    ledger_year_files,
    rename_account_ref,
    rewrite_open_lines,
    validate_account_name,
)
from ledger.services.account_delete_scan import scan_account_delete
from ledger.services.accounts import all_declared_account_names
from ledger.services.candidate import CandidateDiagnostic, consume_token, hash_candidate, issue_token
from ledger.services.ledger_item import Balance, Pad, Transaction
from ledger.services.ledger_render import render_ledger_file
from ledger.services.open_line import parse_open_line
from ledger.services.parser import parse_file


def _apply_rename_to_items(items, old: str, new: str) -> int:
    changed = 0
    for item in items:
        if isinstance(item, Transaction):
            for posting in item.postings:
                renamed = rename_account_ref(posting.account, old, new)
                if renamed != posting.account:
                    posting.account = renamed
                    changed += 1
        elif isinstance(item, Pad):
            for attr in ("account", "source_account"):
                current = getattr(item, attr)
                renamed = rename_account_ref(current, old, new)
                if renamed != current:
                    setattr(item, attr, renamed)
                    changed += 1
        elif isinstance(item, Balance):
            renamed = rename_account_ref(item.account, old, new)
            if renamed != item.account:
                item.account = renamed
                changed += 1
    return changed


def _rename_ledger_file(rel: str, path: Path, old: str, new: str) -> tuple[str, int, list[dict]]:
    parsed = parse_file(path, rel)
    if parsed.diagnostics:
        return path.read_text(encoding="utf-8"), 0, [d.to_dict() for d in parsed.diagnostics]
    changed = _apply_rename_to_items(parsed.items, old, new)
    if not changed:
        return path.read_text(encoding="utf-8"), 0, []
    return render_ledger_file(parsed.items, assign_ids=False), changed, []


def _rename_declaration_file(path: Path, source_file: str, old: str, new: str) -> tuple[str, int]:
    if not path.is_file():
        return "", 0
    text = path.read_text(encoding="utf-8")
    return rewrite_open_lines(text, source_file, old, new)


def scan_account_migration(old_name: str, new_name: str) -> dict:
    old = (old_name or "").strip()
    new = (new_name or "").strip()
    if not old or not new:
        raise ValueError("旧名与新名均不能为空")
    if old == new:
        raise ValueError("新名须与旧名不同")
    validate_account_name(old)
    validate_account_name(new)
    if old.split(":")[0] != new.split(":")[0]:
        raise ValueError("新名须与旧名同根类型")

    declared = set(all_declared_account_names())
    if old not in declared:
        raise ValueError("旧账户不存在")
    if new in declared and new != old:
        raise ValueError("新账户名已存在")

    delete_scan = scan_account_delete(old)
    affected_files: list[dict] = []
    posting_count = 0
    pad_count = 0
    balance_count = 0
    open_count = 0
    account_count = 0
    blocking_diagnostics: list[dict] = []

    for rel, path in ledger_year_files():
        if not path.is_file():
            continue
        parsed = parse_file(path, rel)
        if parsed.diagnostics:
            blocking_diagnostics.extend(d.to_dict() for d in parsed.diagnostics)
            continue
        file_changed = 0
        for item in parsed.items:
            if isinstance(item, Transaction):
                for posting in item.postings:
                    if rename_account_ref(posting.account, old, new) != posting.account:
                        posting_count += 1
                        account_count += 1
                        file_changed += 1
            elif isinstance(item, Pad):
                for attr in ("account", "source_account"):
                    current = getattr(item, attr)
                    if rename_account_ref(current, old, new) != current:
                        pad_count += 1
                        account_count += 1
                        file_changed += 1
            elif isinstance(item, Balance):
                if rename_account_ref(item.account, old, new) != item.account:
                    balance_count += 1
                    account_count += 1
                    file_changed += 1
        if file_changed:
            affected_files.append({"file": rel, "changes": file_changed})

    for path, source_file in ((ACCOUNT_FILE, "account.bean"), (CATEGORY_FILE, "category.bean")):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        for line_no, line in enumerate(text.splitlines(), start=1):
            item = parse_open_line(line, source_file, line_no)
            if not item:
                continue
            renamed = rename_account_ref(item["name"], old, new)
            if renamed != item["name"]:
                open_count += 1
                account_count += 1
                rel = source_file
                existing = next((f for f in affected_files if f["file"] == rel), None)
                if existing:
                    existing["changes"] += 1
                else:
                    affected_files.append({"file": rel, "changes": 1})

    child_accounts = delete_scan.get("child_accounts") or []
    return {
        "ok": True,
        "old_name": old,
        "new_name": new,
        "affected_files": affected_files,
        "posting_count": posting_count,
        "pad_count": pad_count,
        "balance_count": balance_count,
        "open_count": open_count,
        "account_count": account_count,
        "child_accounts": child_accounts,
        "blocking_diagnostics": blocking_diagnostics,
        "can_migrate": not blocking_diagnostics and account_count > 0,
    }


def _prepare_migration_files(old: str, new: str) -> tuple[dict[str, str], int, list[dict]]:
    outputs: dict[str, str] = {}
    total_changes = 0
    diagnostics: list[dict] = []

    for rel, path in ledger_year_files():
        if not path.is_file():
            continue
        text, changed, diags = _rename_ledger_file(rel, path, old, new)
        diagnostics.extend(diags)
        if changed:
            outputs[rel] = text
            total_changes += changed

    for path, source_file in ((ACCOUNT_FILE, "account.bean"), (CATEGORY_FILE, "category.bean")):
        text, changed = _rename_declaration_file(path, source_file, old, new)
        if changed:
            outputs[source_file] = text
            total_changes += changed

    return outputs, total_changes, diagnostics


def _hash_migration(outputs: dict[str, str], old: str, new: str) -> str:
    parts = [f"{old}\n{new}\n"]
    for key in sorted(outputs):
        parts.append(f"{key}\n{outputs[key]}")
    return hash_candidate("".join(parts))


def beancount_check_migration(outputs: dict[str, str]) -> list[CandidateDiagnostic]:
    try:
        from beancount import loader
    except ImportError:
        return [CandidateDiagnostic(message="Beancount 未安装", item_ids=[])]

    with tempfile.TemporaryDirectory(prefix="orbita-migrate-") as tmp:
        tmp_root = Path(tmp)
        for name in ("account.bean", "category.bean"):
            src = DATA_DIR / name
            if src.is_file():
                text = outputs.get(name, src.read_text(encoding="utf-8"))
                (tmp_root / name).write_text(text, encoding="utf-8")
        for rel, path in ledger_year_files():
            rel_text = outputs.get(rel)
            if rel_text is None and path.is_file():
                rel_text = path.read_text(encoding="utf-8")
            if rel_text is None:
                continue
            target = tmp_root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(rel_text, encoding="utf-8")
        includes = [
            f'include "{name}"'
            for name in ("account.bean", "category.bean")
            if (tmp_root / name).is_file()
        ]
        for rel, _path in ledger_year_files():
            if (tmp_root / rel).is_file():
                includes.append(f'include "{rel}"')
        main_bean = tmp_root / "main.bean"
        main_bean.write_text("\n".join(includes) + "\n", encoding="utf-8")
        _entries, errors, _options = loader.load_file(str(main_bean))
        if not errors:
            return []
        return [
            CandidateDiagnostic(message=getattr(err, "message", None) or str(err), item_ids=[], raw=str(err))
            for err in errors
        ]


def validate_account_migration(old_name: str, new_name: str) -> dict:
    scan = scan_account_migration(old_name, new_name)
    if scan.get("blocking_diagnostics"):
        return {
            "ok": False,
            "diagnostics": scan["blocking_diagnostics"],
            "scan": scan,
        }
    if not scan.get("can_migrate"):
        return {"ok": False, "error": "没有可迁移的引用", "scan": scan}

    outputs, total_changes, diags = _prepare_migration_files(scan["old_name"], scan["new_name"])
    if diags:
        return {"ok": False, "diagnostics": diags, "scan": scan}
    if total_changes <= 0:
        return {"ok": False, "error": "没有可迁移的引用", "scan": scan}

    bc_errors = beancount_check_migration(outputs)
    if bc_errors:
        return {"ok": False, "diagnostics": [d.to_dict() for d in bc_errors], "scan": scan}

    candidate_hash = _hash_migration(outputs, scan["old_name"], scan["new_name"])
    token = issue_token(candidate_hash)
    return {
        "ok": True,
        "scan": scan,
        "validation_token": token,
        "candidate_hash": candidate_hash,
        "file_count": len(outputs),
        "change_count": total_changes,
    }


def commit_account_migration(
    old_name: str,
    new_name: str,
    *,
    validation_token: str,
    candidate_hash: str,
) -> dict:
    old = (old_name or "").strip()
    new = (new_name or "").strip()
    if not validation_token or not candidate_hash:
        raise ValueError("缺少迁移确认信息")
    if not consume_token(validation_token, candidate_hash):
        raise ValueError("迁移确认已失效，请重新校验")

    outputs, total_changes, diags = _prepare_migration_files(old, new)
    if diags:
        raise ValueError("迁移目标文件含不受支持内容")
    if total_changes <= 0:
        raise ValueError("没有可迁移的引用")
    if _hash_migration(outputs, old, new) != candidate_hash:
        raise ValueError("迁移内容已变化，请重新校验")

    bc_errors = beancount_check_migration(outputs)
    if bc_errors:
        raise ValueError(bc_errors[0].message)

    # A filesystem has no atomic multi-file replace.  Keep byte-for-byte backups
    # until every replacement succeeds, then compensate from those snapshots on
    # any failure; migration must never leave a partly renamed ledger.
    replacements: list[tuple[Path, Path, Path, bytes | None]] = []
    try:
        for rel, text in outputs.items():
            target = DATA_DIR / rel
            nonce = uuid.uuid4().hex
            tmp = target.with_name(f".{target.name}.orbita-migrate-{nonce}.tmp")
            backup = target.with_name(f".{target.name}.orbita-migrate-{nonce}.bak")
            tmp.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_text(text, encoding="utf-8")
            original = target.read_bytes() if target.is_file() else None
            replacements.append((tmp, backup, target, original))

        # Move every original aside before installing any candidate.  This is a
        # rollback set, not a claim of atomic multi-file replacement.
        for _tmp, backup, target, _original in replacements:
            if target.exists():
                target.replace(backup)
        for tmp, _backup, target, _original in replacements:
            tmp.replace(target)
    except Exception:
        # Do not rely on a second replace succeeding: a failure may be caused by
        # a target-specific replace error.  Restore the captured bytes directly.
        for _tmp, _backup, target, original in replacements:
            if original is None:
                if target.is_file():
                    target.unlink(missing_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(original)
        for tmp, backup, _target, _original in replacements:
            if tmp.is_file():
                tmp.unlink(missing_ok=True)
            if backup.is_file():
                backup.unlink(missing_ok=True)
        raise
    else:
        for _tmp, backup, _target, _original in replacements:
            if backup.is_file():
                backup.unlink(missing_ok=True)

    return {
        "ok": True,
        "old_name": old,
        "new_name": new,
        "files": sorted(outputs.keys()),
        "change_count": total_changes,
    }

from ledger.config import DATA_DIR
from ledger.services.candidate import (
    compute_version_fingerprint,
    finalize_token,
    fingerprints_match,
    get_token_entry,
    hash_candidate,
    release_token,
    reserve_token,
    write_target_lock,
)
from ledger.services.candidate_validate import on_disk_safety_diagnostics
from ledger.services.io import atomic_write, resolve_data_path
from ledger.services.ledger_item import active_items
from ledger.services.ledger_item_validate import validate_ledger_items
from ledger.services.ledger_render import render_ledger_file
from ledger.services.settings import get_write_target


def commit_validated_items(items: list[dict], validation_token: str, candidate_hash: str) -> None:
    if not reserve_token(validation_token, candidate_hash):
        raise ValueError("验证已失效，请重新保存")

    try:
        disk_diags = on_disk_safety_diagnostics()
        if disk_diags:
            # v0.0.17-spec.md §4.2 — never overwrite unsupported on-disk content
            raise ValueError(disk_diags[0].message)

        active = active_items(items)
        if not active:
            raise ValueError("工作副本为空")

        parsed, model_diags = validate_ledger_items(active)
        if model_diags:
            raise ValueError(model_diags[0].message)

        text = render_ledger_file(parsed, assign_ids=True)
        if hash_candidate(text) != candidate_hash:
            raise ValueError("候选内容已变更，请重新保存")

        write_target = get_write_target()
        path = resolve_data_path(write_target)
        lock = write_target_lock(write_target)
        with lock:
            entry = get_token_entry(validation_token)
            if entry is None:
                raise ValueError("验证已失效，请重新保存")
            current_fingerprint = compute_version_fingerprint()
            if not fingerprints_match(entry.fingerprint, current_fingerprint):
                raise ValueError("磁盘内容已变更，请重新加载")
            if hash_candidate(text) != candidate_hash:
                raise ValueError("候选内容已变更，请重新保存")
            atomic_write(path, text)
        if not finalize_token(validation_token, candidate_hash):
            raise ValueError("验证已失效，请重新保存")
    except Exception:
        release_token(validation_token)
        raise

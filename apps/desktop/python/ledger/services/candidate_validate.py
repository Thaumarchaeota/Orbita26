from ledger.config import DATA_DIR
from ledger.services.candidate import (
    CandidateDiagnostic,
    beancount_check_in_temp,
    compute_version_fingerprint,
    hash_candidate,
    issue_token,
)
from ledger.services.ledger_item import active_items, collect_identity_backfill
from ledger.services.ledger_item_validate import validate_ledger_items
from ledger.services.ledger_render import render_ledger_candidate
from ledger.services.parser import parse_write_target
from ledger.services.settings import get_write_target


def on_disk_safety_diagnostics() -> list[CandidateDiagnostic]:
    # docs/specs/orbita-finance.md — unsupported on-disk content must block validate/commit
    return list(parse_write_target().diagnostics)


def validate_candidate_items(
    items: list[dict],
) -> tuple[bool, list[dict], str | None, str | None, list[dict]]:
    disk_diags = on_disk_safety_diagnostics()
    if disk_diags:
        return False, [d.to_dict() for d in disk_diags], None, None, []

    active = active_items(items)
    if not active:
        return (
            False,
            [CandidateDiagnostic(message="工作副本为空", item_ids=[]).to_dict()],
            None,
            None,
            [],
        )

    parsed, model_diags = validate_ledger_items(active)
    if model_diags:
        return False, [d.to_dict() for d in model_diags], None, None, []

    identity_backfill = collect_identity_backfill(parsed)
    text, line_ranges = render_ledger_candidate(parsed, assign_ids=True)
    candidate_hash = hash_candidate(text)

    write_target = get_write_target()
    bc_errors = beancount_check_in_temp(DATA_DIR, write_target, text, line_ranges)
    if bc_errors:
        return False, [d.to_dict() for d in bc_errors], None, None, []

    token = issue_token(candidate_hash, compute_version_fingerprint())
    return True, [], token, candidate_hash, identity_backfill

from fastapi import APIRouter, Query

from ledger.services.ledger_item import item_to_dict
from ledger.services.parser import parse_write_target

router = APIRouter()


@router.get("/entries")
def list_entries(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    parsed = parse_write_target()
    all_items = parsed.items
    all_dates = [item.date for item in all_items]
    filtered = all_items
    if date_from:
        filtered = [item for item in filtered if item.date >= date_from]
    if date_to:
        filtered = [item for item in filtered if item.date <= date_to]
    total = len(filtered)
    if limit is not None:
        page = filtered[offset : offset + limit]
        has_more = offset + limit < total
    elif offset:
        page = filtered[offset:]
        has_more = False
    else:
        page = filtered
        has_more = False
    return {
        "entries": [item_to_dict(item) for item in page],
        "diagnostics": [d.to_dict() for d in parsed.diagnostics],
        "total": total,
        "has_more": has_more,
        "date_min": min(all_dates) if all_dates else None,
        "date_max": max(all_dates) if all_dates else None,
    }

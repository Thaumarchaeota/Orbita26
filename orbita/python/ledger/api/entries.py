from fastapi import APIRouter, Query

from ledger.services.parser import parse_write_target

router = APIRouter()


@router.get("/entries")
def list_entries(
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    all_entries = parse_write_target()
    all_dates = [e.date for e in all_entries]
    filtered = all_entries
    if date_from:
        filtered = [e for e in filtered if e.date >= date_from]
    if date_to:
        filtered = [e for e in filtered if e.date <= date_to]
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
        "entries": [e.to_dict() for e in page],
        "total": total,
        "has_more": has_more,
        "date_min": min(all_dates) if all_dates else None,
        "date_max": max(all_dates) if all_dates else None,
    }

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ledger.services.stats import compute_account_period_stats, get_stats

router = APIRouter()


@router.get("/stats")
def read_stats():
    result = get_stats()
    if not result.get("ok"):
        return JSONResponse(status_code=503, content=result)
    return result


@router.get("/stats/account-period")
def read_account_period_stats(
    account: str = Query(..., min_length=1),
    date_from: str | None = None,
    date_to: str | None = None,
):
    result = compute_account_period_stats(account, date_from, date_to)
    if not result.get("ok"):
        status = 400 if result.get("kind") == "validation" else 503
        return JSONResponse(status_code=status, content=result)
    return result

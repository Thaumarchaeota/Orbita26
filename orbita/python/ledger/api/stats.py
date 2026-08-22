from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ledger.services.stats import get_stats

router = APIRouter()


@router.get("/stats")
def read_stats():
    result = get_stats()
    if not result.get("ok"):
        return JSONResponse(status_code=503, content=result)
    return result

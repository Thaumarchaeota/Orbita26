from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.settings import get_settings, save_settings

router = APIRouter()


class SettingsModel(BaseModel):
    write_target: str
    reporting_currency: str | None = None
    card_stripes: dict[str, str] | None = None


@router.get("/settings")
def read_settings():
    return get_settings()


@router.put("/settings")
def update_settings(req: SettingsModel):
    try:
        # `None` means an old client did not know about reporting_currency.
        return save_settings(req.model_dump(exclude_none=True))
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

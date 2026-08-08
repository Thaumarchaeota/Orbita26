from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.settings import get_settings, save_settings

router = APIRouter()


class SettingsModel(BaseModel):
    write_target: str


@router.get("/settings")
def read_settings():
    return get_settings()


@router.put("/settings")
def update_settings(req: SettingsModel):
    try:
        return save_settings(req.model_dump())
    except ValueError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

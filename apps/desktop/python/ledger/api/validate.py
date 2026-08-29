from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.api.schemas import EntryModel
from ledger.services.candidate_validate import validate_candidate_items

router = APIRouter()


class ValidateRequest(BaseModel):
    items: list[EntryModel]


@router.post("/validate")
def validate(req: ValidateRequest):
    ok, diagnostics, token, candidate_hash, identity_backfill = validate_candidate_items(
        [e.model_dump() for e in req.items]
    )
    if not ok:
        return JSONResponse(
            content={"ok": False, "diagnostics": diagnostics},
            status_code=400,
        )
    return {
        "ok": True,
        "diagnostics": [],
        "validation_token": token,
        "candidate_hash": candidate_hash,
        "identity_backfill": identity_backfill,
    }

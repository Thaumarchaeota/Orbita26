from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.api.commit import EntryModel, PostingModel
from ledger.services.commit import entry_from_dict
from ledger.services.validate import validate_entries

router = APIRouter()


class ValidateRequest(BaseModel):
    entries: list[EntryModel]


@router.post("/validate")
def validate(req: ValidateRequest):
    if not req.entries:
        return {"ok": True, "errors": []}
    entries = [entry_from_dict(e.model_dump()) for e in req.entries]
    errors = validate_entries(entries)
    return JSONResponse(
        content={"ok": len(errors) == 0, "errors": errors},
    )

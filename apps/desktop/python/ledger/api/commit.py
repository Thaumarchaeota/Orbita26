from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.api.schemas import EntryModel
from ledger.services.candidate_commit import commit_validated_items

router = APIRouter()


class CommitRequest(BaseModel):
    items: list[EntryModel]
    validation_token: str
    candidate_hash: str


@router.post("/commit")
def commit(req: CommitRequest):
    try:
        commit_validated_items(
            [e.model_dump() for e in req.items],
            req.validation_token,
            req.candidate_hash,
        )
        return {"ok": True}
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})

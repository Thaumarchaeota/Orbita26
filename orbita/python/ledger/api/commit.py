from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.commit import commit_files, entry_from_dict
from ledger.services.models import Entry

router = APIRouter()


class PostingModel(BaseModel):
    account: str
    amount: float
    currency: str = "CNY"
    cost_amount: float | None = None
    cost_currency: str = ""


class EntryModel(BaseModel):
    id: str = ""
    source_file: str
    source_line: int = 0
    type: str
    date: str
    flag: str = "*"
    payee: str = ""
    remark: str = ""
    tags: str = ""
    postings: list[PostingModel]
    seq: str = ""


class CommitRequest(BaseModel):
    files: dict[str, list[EntryModel]]


@router.post("/commit")
def commit(req: CommitRequest):
    if not req.files:
        return JSONResponse(status_code=400, content={"ok": False, "error": "无文件可提交"})

    parsed: dict[str, list[Entry]] = {}
    for source_file, entry_models in req.files.items():
        if source_file.endswith("_inv.bean"):
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": f"不支持 inv 文件: {source_file}"},
            )
        parsed[source_file] = [
            entry_from_dict(e.model_dump()) for e in entry_models
        ]

    results, all_ok = commit_files(parsed)
    status = 200 if all_ok else 207
    return JSONResponse(
        status_code=status,
        content={"ok": all_ok, "results": results},
    )

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ledger.services.category_commit import commit_categories

router = APIRouter()


class CategoryModel(BaseModel):
    id: str = ""
    source_file: str
    source_line: int
    name: str
    label: str = ""
    open_date: str = "2026-01-01"
    extra: str = ""


class CategoryCommitRequest(BaseModel):
    categories: list[CategoryModel]


@router.post("/categories/commit")
def commit(req: CategoryCommitRequest):
    if not req.categories:
        return JSONResponse(status_code=400, content={"ok": False, "error": "无分类可提交"})
    try:
        commit_categories([c.model_dump() for c in req.categories])
    except ValueError as e:
        return JSONResponse(status_code=400, content={"ok": False, "error": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
    return {"ok": True}

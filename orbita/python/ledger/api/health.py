from fastapi import APIRouter

router = APIRouter()
VERSION = "0.0.17"


@router.get("/health")
def health():
    return {"ok": True, "version": VERSION}
